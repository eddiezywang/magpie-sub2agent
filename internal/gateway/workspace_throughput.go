package gateway

// Workspace throughput is independent of the Sessions speed meter. Values are
// converted at ingestion so changing model rates never rewrites history.
import (
	"encoding/json"
	"sort"
	"sync"
	"time"
)

const throughputSpan = 180

type throughputBucket struct {
	Second  int64
	Tokens  float64
	Unknown bool
}
type throughputTrack struct {
	ID, Name, Agent, Provider string
	Started, Heard, At        int64
	Peak                      float64
	Buckets                   [throughputSpan]throughputBucket
}
type ThroughputSeries struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Agent       string     `json:"agent,omitempty"`
	Provider    string     `json:"provider,omitempty"`
	StartedAt   int64      `json:"startedAt"`
	Calibration string     `json:"calibration"`
	Current     *float64   `json:"current"`
	Peak        *float64   `json:"peak"`
	Points      []*float64 `json:"points"`
}
type ThroughputState struct {
	Version         int                `json:"version"`
	Epoch           int64              `json:"epoch"`
	AsOf            int64              `json:"asOf"`
	IntervalSeconds int                `json:"intervalSeconds"`
	WindowSeconds   int                `json:"windowSeconds"`
	SmoothSeconds   int                `json:"smoothSeconds"`
	Status          string             `json:"status"`
	Total           ThroughputSeries   `json:"total"`
	Providers       []ThroughputSeries `json:"providers"`
	Models          []ThroughputSeries `json:"models"`
	Sessions        []ThroughputSeries `json:"sessions"`
	Truncated       bool               `json:"truncated"`
	OmittedSeries   int64              `json:"omittedSeries"`
}
type throughputMeter struct {
	mu                          sync.Mutex
	now                         func() time.Time
	epoch                       int64
	total                       *throughputTrack
	providers, models, sessions map[string]*throughputTrack
	omitted                     int64
}

func throughputID(parts ...string) string { b, _ := json.Marshal(parts); return string(b) }
func (m *throughputMeter) clock() time.Time {
	if m.now != nil {
		return m.now()
	}
	return time.Now()
}
func (t *throughputTrack) mean(second int64) (float64, bool) {
	var sum float64
	for s := second - 4; s <= second; s++ {
		b := t.Buckets[(s%throughputSpan+throughputSpan)%throughputSpan]
		if b.Second == s {
			if b.Unknown {
				return 0, false
			}
			sum += b.Tokens
		}
	}
	return sum / 5, true
}
func (t *throughputTrack) advance(now int64) {
	// Evaluate peaks before old ring entries can be overwritten. At most one
	// window plus four trailing means can contain contributions after a gap.
	end := min(now-1, t.At+throughputSpan+4)
	for s := t.At; s <= end; s++ {
		if v, ok := t.mean(s); ok && v > t.Peak {
			t.Peak = v
		}
	}
	t.At = now
}
func (m *throughputMeter) track(set map[string]*throughputTrack, id, name, agent, provider string, limit int, now int64) *throughputTrack {
	if t := set[id]; t != nil {
		return t
	}
	if len(set) >= limit {
		var oldest *throughputTrack
		for _, t := range set {
			if oldest == nil || t.Heard < oldest.Heard || t.Heard == oldest.Heard && t.ID < oldest.ID {
				oldest = t
			}
		}
		delete(set, oldest.ID)
		m.omitted++
	}
	t := &throughputTrack{ID: id, Name: name, Agent: agent, Provider: provider, Started: now, Heard: now, At: now}
	set[id] = t
	return t
}
func (m *throughputMeter) add(agent, session, provider, model string, content int64, rate float64, rated bool) {
	if m == nil || content <= 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	stamp := m.clock()
	now := stamp.Unix()
	if m.total == nil {
		m.epoch = stamp.UnixNano()
		m.total = &throughputTrack{ID: "total", Name: "Total", Started: now, At: now}
		m.providers = map[string]*throughputTrack{}
		m.models = map[string]*throughputTrack{}
		m.sessions = map[string]*throughputTrack{}
	}
	if m.providers == nil {
		m.providers = map[string]*throughputTrack{}
		m.models = map[string]*throughputTrack{}
		m.sessions = map[string]*throughputTrack{}
	}
	sessionName := session
	if sessionName == "" {
		sessionName = "Unidentified session"
	}
	tracks := []*throughputTrack{m.total, m.track(m.providers, provider, provider, "", "", 128, now), m.track(m.models, throughputID(provider, model), model, "", provider, 512, now), m.track(m.sessions, throughputID(agent, session), sessionName, agent, "", 256, now)}
	for _, t := range tracks {
		t.advance(now)
		t.Heard = now
		i := now % throughputSpan
		b := &t.Buckets[i]
		if b.Second != now {
			*b = throughputBucket{Second: now}
		}
		if rated {
			b.Tokens += float64(content) * rate
		} else {
			b.Unknown = true
		}
	}
}
func (t *throughputTrack) series(now int64) ThroughputSeries {
	out := ThroughputSeries{ID: t.ID, Name: t.Name, Agent: t.Agent, Provider: t.Provider, StartedAt: t.Started, Calibration: "ok", Points: make([]*float64, throughputSpan)}
	for i := 0; i < throughputSpan; i++ {
		s := now - throughputSpan + int64(i)
		if s < t.Started {
			continue
		}
		b := t.Buckets[s%throughputSpan]
		if b.Second == s && b.Unknown {
			out.Calibration = "uncalibrated"
			continue
		}
		v := 0.0
		if b.Second == s {
			v = b.Tokens
		}
		out.Points[i] = &v
	}
	if v, ok := t.mean(now - 1); ok {
		out.Current = &v
	}
	peak := t.Peak
	out.Peak = &peak
	return out
}
func (m *throughputMeter) snapshot() ThroughputState {
	m.mu.Lock()
	stamp := m.clock()
	now := stamp.Unix()
	// Initialize the idle process too: a healthy idle gateway is not unavailable.
	if m.total == nil {
		m.epoch = stamp.UnixNano()
		m.total = &throughputTrack{ID: "total", Name: "Total", Started: now, At: now}
	}
	m.total.advance(now)
	total := *m.total
	clone := func(set map[string]*throughputTrack) []throughputTrack {
		rows := make([]throughputTrack, 0, len(set))
		for _, t := range set {
			t.advance(now)
			rows = append(rows, *t)
		}
		return rows
	}
	providers, models, sessions := clone(m.providers), clone(m.models), clone(m.sessions)
	epoch, omitted := m.epoch, m.omitted
	m.mu.Unlock()
	out := ThroughputState{Version: 1, Epoch: epoch, AsOf: now - 1, IntervalSeconds: 1, WindowSeconds: 180, SmoothSeconds: 5, Status: "ok", Total: total.series(now), Truncated: omitted > 0, OmittedSeries: omitted}
	rows := func(src []throughputTrack) []ThroughputSeries {
		sort.Slice(src, func(i, j int) bool { return src[i].ID < src[j].ID })
		dst := make([]ThroughputSeries, 0, len(src))
		for i := range src {
			dst = append(dst, src[i].series(now))
		}
		return dst
	}
	out.Providers = rows(providers)
	out.Models = rows(models)
	out.Sessions = rows(sessions)
	if out.Total.Calibration != "ok" {
		out.Status = "partial"
	}
	return out
}

// Throughput reads the workspace meter without changing Sessions speed semantics.
func (s *Server) Throughput() ThroughputState { return s.throughput.snapshot() }
