package accounting

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand/v2"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/yetone/magpie/internal/usage"
)

type Options struct {
	LegacyEnabled bool   `json:"-"`
	UsageEnabled  bool   `json:"-"`
	LegacyURL     string `json:"-"`
	UsageURL      string `json:"-"`
}

func Defaults() Options {
	return Options{LegacyEnabled: true, UsageEnabled: true, LegacyURL: "http://172.21.0.177:17890/events", UsageURL: "http://172.21.0.177:17890/usage/events"}
}

// The historical opt-out now controls reporting as a whole. Distribution-owned
// destinations cannot be replaced by user config or environment variables.
func (o Options) WithEnv() Options {
	if v, ok := os.LookupEnv("CB_PROXY_TELEMETRY"); ok {
		switch strings.ToLower(strings.TrimSpace(v)) {
		case "", "0", "false", "no", "off":
			o.LegacyEnabled = false
		default:
			o.LegacyEnabled = true
		}
		o.UsageEnabled = o.LegacyEnabled
	}
	return o
}

type Status struct {
	LegacyEnabled bool      `json:"legacy_enabled"`
	UsageEnabled  bool      `json:"usage_enabled"`
	Pending       int       `json:"pending"`
	PendingBytes  int64     `json:"pending_bytes"`
	QueueFailures uint64    `json:"queue_failures"`
	LastError     string    `json:"last_error,omitempty"`
	LastSuccess   time.Time `json:"last_success,omitempty"`
	MemoryGroups  int       `json:"memory_groups"`
	DroppedCalls  uint64    `json:"dropped_calls"`
	RulesRevision string    `json:"rules_revision,omitempty"`
}

type Runtime struct {
	queue        *Queue
	options      Options
	sender       Sender
	identity     Identity
	version, dir string
	mu           sync.Mutex
	running      bool
	started      time.Time
	uptime       time.Duration
	quitOnce     sync.Once
	cancel       context.CancelFunc
	done         chan struct{}
	flushMu      sync.Mutex
	statusMu     sync.Mutex
	statusWrite  sync.Mutex
	status       Status
	tokens       atomic.Uint64
	minutes      minuteBuffer
	sealMu       sync.Mutex
	rules        *AggregationRules
	wake         chan struct{}
}

var appStarts sync.Map

func New(dir string, options Options, version string) (*Runtime, error) {
	if options.LegacyEnabled {
		if _, err := endpoint(options.LegacyURL); err != nil {
			return nil, err
		}
	}
	if options.UsageEnabled {
		if _, err := endpoint(options.UsageURL); err != nil {
			return nil, err
		}
	}
	q, err := OpenQueue(filepath.Join(dir, "accounting-outbox"), 20<<20)
	if err != nil {
		return nil, err
	}
	for kind, on := range map[string]bool{"legacy": options.LegacyEnabled, "usage": options.UsageEnabled, "summary": options.UsageEnabled} {
		if !on {
			if err = q.Clear(kind); err != nil {
				return nil, err
			}
		}
	}
	id, err := loadIdentity(filepath.Join(dir, "telemetry.json"))
	if err != nil {
		return nil, err
	}
	r := &Runtime{queue: q, options: options, identity: id, dir: dir, version: version, wake: make(chan struct{}, 1), sender: Sender{LegacyURL: options.LegacyURL, UsageURL: options.UsageURL, Reject: q.Reject}}
	r.status.LegacyEnabled = options.LegacyEnabled
	r.status.UsageEnabled = options.UsageEnabled
	if rules, err := readRules(filepath.Join(dir, "accounting-rules.json")); err == nil {
		r.rules = rules
	} else if !os.IsNotExist(err) {
		r.noteError(err, false)
	}
	r.writeStatus()
	return r, nil
}

func loadIdentity(path string) (Identity, error) {
	data, err := os.ReadFile(path)
	var id Identity
	if err == nil {
		if json.Unmarshal(data, &id) != nil || !validID(id.InstallID) {
			return id, fmt.Errorf("invalid telemetry identity file")
		}
	} else if os.IsNotExist(err) {
		id.InstallID = NewID()
		data, _ = json.Marshal(id)
		f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err != nil {
			return id, err
		}
		if _, err = f.Write(data); err != nil {
			f.Close()
			return id, err
		}
		if err = f.Sync(); err != nil {
			f.Close()
			return id, err
		}
		if err = f.Close(); err != nil {
			return id, err
		}
	} else {
		return id, err
	}
	id.Username = os.Getenv("USERNAME")
	if id.Username == "" {
		id.Username = os.Getenv("USER")
	}
	if id.Username == "" {
		id.Username = "unknown"
	}
	return id, nil
}

func (*Runtime) Bodies() usage.Bodies            { return usage.NoBodies }
func (*Runtime) Begin(usage.Request) usage.Watch { return nil }

func (r *Runtime) Ledger(rec usage.Record) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.running || rec.IsProbe() || rec.IsRejected() || rec.Source != "" || rec.Computer != "" {
		return
	}
	for _, n := range []int{rec.Input, rec.Output, rec.CacheRead, rec.CacheWrite} {
		if n > 0 {
			r.tokens.Add(uint64(n))
		}
	}
	if !r.options.UsageEnabled {
		return
	}
	if err := r.minutes.Add(rec, time.Now(), r.rules); err != nil {
		r.statusMu.Lock()
		r.status.DroppedCalls++
		r.statusMu.Unlock()
		r.noteError(err, false)
	}
}

func (r *Runtime) enqueue(kind, id string, payload any) bool {
	b, err := json.Marshal(payload)
	if err == nil {
		err = r.queue.Put(Item{ID: id, Kind: kind, Identity: r.identity, Payload: b})
	}
	if err != nil {
		r.noteError(err, true)
		return false
	}
	return true
}

// Only this background/stop path touches disk for new usage. Failed puts keep
// immutable packets in bounded memory with the same ID for a later retry.
func (r *Runtime) persistMinutes(now time.Time, all bool) {
	r.sealMu.Lock()
	defer r.sealMu.Unlock()
	r.minutes.Seal(now, all)
	for {
		packet, ok := r.minutes.First()
		if !ok || !r.enqueue("summary", packet.ID, packet) {
			return
		}
		r.minutes.Saved(packet.ID)
	}
}

func (r *Runtime) legacy(name string, argv ...string) {
	if !r.options.LegacyEnabled {
		return
	}
	e, err := Legacy(r.identity, NewID(), name, r.version, time.Now(), argv)
	if err != nil {
		r.noteError(err, false)
		return
	}
	r.enqueue("legacy", e.ID, e)
}

func (r *Runtime) Serve() func() {
	r.mu.Lock()
	if r.running {
		r.mu.Unlock()
		return func() {}
	}
	r.running = true
	r.started = time.Now()
	r.tokens.Store(0)
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.done = make(chan struct{})
	done := r.done
	r.mu.Unlock()
	if r.options.LegacyEnabled {
		if _, started := appStarts.LoadOrStore(r.dir, true); !started {
			r.legacy("desktop_app_start")
		}
	}
	r.legacy("desktop_proxy_start")
	started, last := time.Now(), time.Now()
	go func() {
		defer close(done)
		var workers sync.WaitGroup
		workers.Go(func() { r.deliver(ctx) })
		defer workers.Wait()
		seal := time.NewTimer(time.Until(time.Now().UTC().Truncate(time.Minute).Add(time.Minute)))
		defer seal.Stop()
		active := time.NewTicker(10 * time.Minute)
		defer active.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-seal.C:
				r.persistMinutes(now, false)
				select {
				case r.wake <- struct{}{}:
				default:
				}
				seal.Reset(time.Until(time.Now().UTC().Truncate(time.Minute).Add(time.Minute)))
			case now := <-active.C:
				r.legacy("desktop_proxy_usage_flushed", "--proxy-usage-ms="+strconv.FormatInt(now.Sub(last).Milliseconds(), 10), "--proxy-flush-reason=interval")
				last = now
			}
		}
	}()
	var once sync.Once
	return func() {
		once.Do(func() {
			r.mu.Lock()
			r.running = false
			r.uptime = time.Since(r.started)
			r.mu.Unlock()
			cancel()
			<-done
			r.persistMinutes(time.Now(), true)
			// No HTTP on shutdown or disable; durable final events retry next run.
			now := time.Now()
			r.legacy("desktop_proxy_usage_flushed", "--proxy-usage-ms="+strconv.FormatInt(now.Sub(last).Milliseconds(), 10), "--proxy-flush-reason=stop")
			r.legacy("desktop_proxy_stop", "--proxy-uptime-ms="+strconv.FormatInt(now.Sub(started).Milliseconds(), 10), "--proxy-total-tokens="+strconv.FormatUint(r.tokens.Load(), 10))
			r.writeStatus()
		})
	}
}

// AppQuit is called only by the native application's shutdown lifecycle,
// independently of gateway restarts and reporting settings changes.
func (r *Runtime) AppQuit() {
	r.quitOnce.Do(func() {
		r.mu.Lock()
		started, duration := r.started, r.uptime
		if r.running {
			duration = time.Since(started)
		}
		r.mu.Unlock()
		if started.IsZero() {
			return
		}
		r.legacy("desktop_app_quit", "--proxy-uptime-ms="+strconv.FormatInt(duration.Milliseconds(), 10), "--proxy-total-tokens="+strconv.FormatUint(r.tokens.Load(), 10))
		r.writeStatus()
	})
}

// Each plane gets a bounded batch independently; a failed usage collector
// must never prevent old lifecycle events from continuing to arrive.
func (r *Runtime) Flush(ctx context.Context) {
	r.flush(ctx, true)
}

func (r *Runtime) flush(ctx context.Context, sendUsage bool) (usageFailed bool) {
	r.flushMu.Lock()
	defer r.flushMu.Unlock()
	for _, plane := range []struct {
		kind    string
		enabled bool
		batch   int
	}{{"legacy", r.options.LegacyEnabled, 1}, {"summary", r.options.UsageEnabled && sendUsage, 16}, {"usage", r.options.UsageEnabled && sendUsage, 200}} {
		if !plane.enabled || ctx.Err() != nil {
			continue
		}
		for n := 0; n < 200; n += plane.batch {
			items := r.queue.Pending(plane.kind, plane.batch)
			if len(items) == 0 {
				break
			}
			ids, err := r.sender.Send(ctx, items)
			if err == nil {
				err = r.queue.Ack(ids)
			}
			if err != nil {
				if ctx.Err() != nil {
					break
				}
				if plane.kind != "legacy" {
					usageFailed = true
				}
				r.noteError(err, false)
				break
			}
			r.statusMu.Lock()
			r.status.LastSuccess = time.Now().UTC()
			r.statusMu.Unlock()
			if len(ids) < len(items) {
				break
			}
		}
	}
	r.writeStatus()
	return usageFailed
}

// One HTTP worker serves both planes. Collector failures back off only usage;
// legacy telemetry keeps its own delivery opportunities. Minute sealing runs
// independently, including while a collector is hanging or unavailable.
func (r *Runtime) deliver(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	var nextUsage, nextRules time.Time
	backoff := 30 * time.Second
	for {
		select {
		case <-ctx.Done():
			return
		case <-r.wake:
			if !time.Now().Before(nextUsage) {
				timer.Reset(time.Duration(rand.Int64N(int64(5 * time.Second))))
			}
		case <-timer.C:
			now := time.Now()
			if r.options.UsageEnabled && !now.Before(nextRules) {
				if err := r.refreshRules(ctx); err != nil && ctx.Err() == nil {
					r.noteError(err, false)
				}
				nextRules = time.Now().Add(5 * time.Minute)
			}
			if ctx.Err() != nil {
				return
			}
			allowed := !time.Now().Before(nextUsage)
			if r.flush(ctx, allowed) {
				nextUsage = time.Now().Add(backoff + time.Duration(rand.Int64N(int64(5*time.Second))))
				backoff = min(backoff*2, 5*time.Minute)
			} else if allowed {
				nextUsage = time.Time{}
				backoff = 30 * time.Second
			}
			timer.Reset(30*time.Second + time.Duration(rand.Int64N(int64(5*time.Second))))
		}
	}
}

func (r *Runtime) noteError(err error, queueFailure bool) {
	r.statusMu.Lock()
	changed := r.status.LastError != err.Error()
	r.status.LastError = err.Error()
	if queueFailure {
		r.status.QueueFailures++
	}
	r.statusMu.Unlock()
	if changed {
		log.Printf("accounting: %v", err)
	}
}

func (r *Runtime) Snapshot() Status {
	r.statusMu.Lock()
	out := r.status
	r.statusMu.Unlock()
	out.Pending, out.PendingBytes = r.queue.Count()
	out.MemoryGroups = r.minutes.Count()
	r.mu.Lock()
	if r.rules != nil {
		out.RulesRevision = r.rules.Revision
	}
	r.mu.Unlock()
	return out
}

func (r *Runtime) writeStatus() {
	r.statusWrite.Lock()
	defer r.statusWrite.Unlock()
	b, err := json.Marshal(r.Snapshot())
	if err != nil {
		return
	}
	path := filepath.Join(r.dir, "accounting-status.json")
	if err = os.WriteFile(path+".tmp", b, 0600); err == nil {
		_ = os.Rename(path+".tmp", path)
	}
}
