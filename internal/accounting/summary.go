package accounting

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/yetone/magpie/internal/usage"
)

const SummarySchema = "sub2agent-usage/3"
const maxSummaryGroups = 1024
const groupsPerSummary = 16 // keeps even maximum-length identifiers below the queue's 64 KiB limit
const maxCounter int64 = 1<<53 - 1

// AggregationRules contains classification boundaries, never prices. A revision
// is immutable on the collector. Missing rules remain explicitly unclassified.
type AggregationRules struct {
	Revision string      `json:"revision"`
	Models   []ModelRule `json:"models"`
}

type ModelRule struct {
	Provider    string  `json:"provider"`
	Model       string  `json:"model"`
	ServiceTier string  `json:"service_tier"`
	Above       []int64 `json:"above"`
}

func safeLabel(s string, max int) bool {
	return len(s) <= max && !strings.ContainsAny(s, "\r\n\t") && !strings.Contains(s, "://")
}

func (r AggregationRules) Validate() error {
	if r.Revision == "" || !safeLabel(r.Revision, 128) || len(r.Models) > 4096 {
		return fmt.Errorf("invalid aggregation rules")
	}
	seen := map[[3]string]bool{}
	for _, m := range r.Models {
		key := [3]string{m.Provider, m.Model, m.ServiceTier}
		if m.Provider == "" || m.Model == "" || !safeLabel(m.Provider, 256) || !safeLabel(m.Model, 256) || !safeLabel(m.ServiceTier, 256) || seen[key] || len(m.Above) > 32 {
			return fmt.Errorf("invalid or duplicate aggregation model")
		}
		seen[key] = true
		var previous int64
		for _, above := range m.Above {
			if above <= previous || above > maxCounter {
				return fmt.Errorf("invalid aggregation boundaries")
			}
			previous = above
		}
	}
	return nil
}

type SummaryDimensions struct {
	Agent         string `json:"agent"`
	Provider      string `json:"provider"`
	Model         string `json:"model"`
	ModelSource   string `json:"model_source"` // served or requested; never pretend a fallback was observed
	ServiceTier   string `json:"service_tier"`
	RulesRevision string `json:"rules_revision"`
	ContextTier   string `json:"context_tier"` // unclassified, base, or above:N (strictly greater than N)
}

type SummaryCounters struct {
	Attempts          int64 `json:"attempts"`
	Requests          int64 `json:"requests"` // final attempts only; handoffs do not add a logical request
	Success           int64 `json:"success"`
	Failed            int64 `json:"failed"`
	Canceled          int64 `json:"canceled"`
	HandedOn          int64 `json:"handed_on"`
	Input             int64 `json:"input_tokens"`
	Output            int64 `json:"output_tokens"`
	CacheRead         int64 `json:"cache_read_tokens"`
	CacheWrite5m      int64 `json:"cache_write_5m_tokens"`
	CacheWrite1h      int64 `json:"cache_write_1h_tokens"`
	Reasoning         int64 `json:"reasoning_tokens"` // a subset of output, not additional billable tokens
	ZeroTokenCalls    int64 `json:"zero_token_calls"` // missing usage and genuine zero cannot be distinguished by Record
	CacheUnknownCalls int64 `json:"cache_unknown_calls"`
	CacheUnknownInput int64 `json:"cache_unknown_input_tokens"`
	Duration          int64 `json:"duration_ms_sum"`
	DurationSamples   int64 `json:"duration_samples"`
	TTFT              int64 `json:"ttft_ms_sum"`
	TTFTSamples       int64 `json:"ttft_samples"`
}

type SummaryGroup struct {
	SummaryDimensions
	SummaryCounters
}

// Identity (including username) is supplied once by the transport envelope.
// A summary is an immutable delta. Multiple packets for one minute are added,
// never replaced; (install_id, id) makes retries idempotent across restarts.
type MinuteSummary struct {
	ID     string         `json:"id"`
	Minute time.Time      `json:"minute"`
	Groups []SummaryGroup `json:"groups"`
}

type summaryKey struct {
	Minute time.Time
	SummaryDimensions
}

type minuteBuffer struct {
	mu     sync.Mutex
	groups map[summaryKey]SummaryCounters
	ready  []MinuteSummary
	held   int // active and frozen group count; bounded even while disk/collector is unavailable
}

func (b *minuteBuffer) Add(r usage.Record, completed time.Time, rules *AggregationRules) error {
	if r.IsProbe() || r.IsRejected() || r.Source != "" || r.Computer != "" {
		return nil
	}
	if completed.IsZero() {
		return fmt.Errorf("missing completion time")
	}
	for _, n := range []int64{int64(r.Input), int64(r.Output), int64(r.CacheRead), int64(r.CacheWrite), int64(r.CacheWrite1h), int64(r.Reasoning), r.Millis, r.TTFT} {
		if n < 0 || n > maxCounter {
			return fmt.Errorf("invalid summary counter")
		}
	}
	if r.CacheWrite1h > r.CacheWrite {
		return fmt.Errorf("1h writes exceed total cache writes")
	}
	for _, s := range []string{r.Agent, r.Provider, r.Model, r.Served, r.TierServed} {
		if !safeLabel(s, 256) {
			return fmt.Errorf("invalid summary identifier")
		}
	}
	d := SummaryDimensions{Agent: r.Agent, Provider: r.Provider, Model: r.Model, ModelSource: "requested", ServiceTier: r.TierServed, ContextTier: "unclassified"}
	if r.Served != "" {
		d.Model, d.ModelSource = r.Served, "served"
	}
	c := SummaryCounters{Attempts: 1, Input: int64(r.Input), Output: int64(r.Output), CacheRead: int64(r.CacheRead), CacheWrite5m: int64(r.CacheWrite - r.CacheWrite1h), CacheWrite1h: int64(r.CacheWrite1h), Reasoning: int64(r.Reasoning), Duration: r.Millis, TTFT: r.TTFT}
	if !r.HandedOn {
		c.Requests = 1
	} else {
		c.HandedOn = 1
	}
	if r.Canceled() {
		c.Canceled = 1
	} else if r.Failed() {
		c.Failed = 1
	} else {
		c.Success = 1
	}
	if r.Millis > 0 {
		c.DurationSamples = 1
	}
	if r.TTFT > 0 {
		c.TTFTSamples = 1
	}
	if r.Input == 0 && r.Output == 0 && r.CacheRead == 0 && r.CacheWrite == 0 {
		c.ZeroTokenCalls = 1
	}
	if r.CacheUnknown || usage.CountsNoCache(r.Provider) {
		c.CacheUnknownCalls = 1
		c.CacheUnknownInput = c.Input + c.CacheRead + c.CacheWrite5m + c.CacheWrite1h
	}
	if rules != nil {
		d.RulesRevision = rules.Revision
		for _, m := range rules.Models {
			if m.Provider != d.Provider || m.Model != d.Model || m.ServiceTier != d.ServiceTier {
				continue
			}
			// Unknown cache counts or an all-zero record cannot prove a context tier.
			if c.CacheUnknownCalls != 0 || c.ZeroTokenCalls != 0 {
				break
			}
			prompt := c.Input + c.CacheRead + c.CacheWrite5m + c.CacheWrite1h
			d.ContextTier = "base"
			for _, above := range m.Above {
				if prompt > above {
					d.ContextTier = "above:" + strconv.FormatInt(above, 10)
				}
			}
			break
		}
	}
	key := summaryKey{completed.UTC().Truncate(time.Minute), d}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.groups == nil {
		b.groups = make(map[summaryKey]SummaryCounters)
	}
	old, exists := b.groups[key]
	if !exists && b.held >= maxSummaryGroups {
		return fmt.Errorf("minute usage buffer is full")
	}
	if err := old.add(c); err != nil {
		return err
	}
	b.groups[key] = old
	if !exists {
		b.held++
	}
	return nil
}

func (c *SummaryCounters) add(v SummaryCounters) error {
	// Validate all sums before committing any of them.
	a := []*int64{&c.Attempts, &c.Requests, &c.Success, &c.Failed, &c.Canceled, &c.HandedOn, &c.Input, &c.Output, &c.CacheRead, &c.CacheWrite5m, &c.CacheWrite1h, &c.Reasoning, &c.ZeroTokenCalls, &c.CacheUnknownCalls, &c.CacheUnknownInput, &c.Duration, &c.DurationSamples, &c.TTFT, &c.TTFTSamples}
	n := []int64{v.Attempts, v.Requests, v.Success, v.Failed, v.Canceled, v.HandedOn, v.Input, v.Output, v.CacheRead, v.CacheWrite5m, v.CacheWrite1h, v.Reasoning, v.ZeroTokenCalls, v.CacheUnknownCalls, v.CacheUnknownInput, v.Duration, v.DurationSamples, v.TTFT, v.TTFTSamples}
	for i, p := range a {
		if n[i] < 0 || *p > maxCounter-n[i] {
			return fmt.Errorf("summary counter overflow")
		}
	}
	for i, p := range a {
		*p += n[i]
	}
	return nil
}

// Seal freezes elapsed minutes; all also freezes a partial minute on graceful
// stop. No serialization, filesystem or network operations run on Add's path.
func (b *minuteBuffer) Seal(now time.Time, all bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	keys := make([]summaryKey, 0, len(b.groups))
	for k := range b.groups {
		if all || k.Minute.Before(now.UTC().Truncate(time.Minute)) {
			keys = append(keys, k)
		}
	}
	slices.SortFunc(keys, func(a, c summaryKey) int {
		if n := a.Minute.Compare(c.Minute); n != 0 {
			return n
		}
		as := []string{a.Agent, a.Provider, a.Model, a.ModelSource, a.ServiceTier, a.RulesRevision, a.ContextTier}
		cs := []string{c.Agent, c.Provider, c.Model, c.ModelSource, c.ServiceTier, c.RulesRevision, c.ContextTier}
		return slices.Compare(as, cs)
	})
	var packet *MinuteSummary
	for _, k := range keys {
		if packet == nil || !packet.Minute.Equal(k.Minute) || len(packet.Groups) == groupsPerSummary {
			b.ready = append(b.ready, MinuteSummary{ID: NewID(), Minute: k.Minute})
			packet = &b.ready[len(b.ready)-1]
		}
		packet.Groups = append(packet.Groups, SummaryGroup{k.SummaryDimensions, b.groups[k]})
		delete(b.groups, k)
	}
}

func (b *minuteBuffer) First() (MinuteSummary, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.ready) == 0 {
		return MinuteSummary{}, false
	}
	return b.ready[0], true
}

func (b *minuteBuffer) Saved(id string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.ready) > 0 && b.ready[0].ID == id {
		b.held -= len(b.ready[0].Groups)
		b.ready[0] = MinuteSummary{}
		b.ready = b.ready[1:]
	}
}

func (b *minuteBuffer) Count() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.held
}
