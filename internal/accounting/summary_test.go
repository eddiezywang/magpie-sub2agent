package accounting

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/usage"
)

func TestMinuteSummaryAggregatesWithoutRetainingRequests(t *testing.T) {
	now := time.Date(2026, 11, 13, 9, 12, 10, 0, time.UTC)
	rules := &AggregationRules{Revision: "rules-1", Models: []ModelRule{{Provider: "p", Model: "actual", Above: []int64{200}}}}
	var b minuteBuffer
	r := usage.Record{Time: now.Add(-10 * time.Minute), Agent: "codex", Provider: "p", Model: "alias", Served: "actual", Input: 100, Output: 20, Reasoning: 10, CacheRead: 30, CacheWrite: 50, CacheWrite1h: 10, Status: 200, Millis: 80, TTFT: 20, BodyIn: "PRIVATE-PROMPT", Session: "PRIVATE-SESSION", Error: "PRIVATE-ERROR", ProviderAccount: "PRIVATE-ACCOUNT"}
	for range 100 {
		if err := b.Add(r, now, rules); err != nil {
			t.Fatal(err)
		}
	}
	b.Seal(now, false)
	if _, ok := b.First(); ok {
		t.Fatal("current minute was sealed early")
	}
	b.Seal(now.Add(time.Minute), false)
	s, ok := b.First()
	if !ok || !s.Minute.Equal(now.Truncate(time.Minute)) || len(s.Groups) != 1 {
		t.Fatalf("wrong completion-minute summary: %+v", s)
	}
	g := s.Groups[0]
	if g.Attempts != 100 || g.Requests != 100 || g.Input != 10000 || g.Output != 2000 || g.Reasoning != 1000 || g.CacheWrite5m != 4000 || g.CacheWrite1h != 1000 || g.ContextTier != "base" || g.Model != "actual" || g.DurationSamples != 100 || g.TTFT != 2000 {
		t.Fatalf("wrong sums/splits: %+v", g)
	}
	data, _ := json.Marshal(s)
	if strings.Contains(string(data), "PRIVATE") || strings.Contains(string(data), "logical_request_id") {
		t.Fatalf("retained request details: %s", data)
	}
	// Reading/retrying a frozen packet does not change its identity or payload.
	again, _ := b.First()
	if again.ID != s.ID {
		t.Fatal("retry changed summary identity")
	}
	b.Saved(s.ID)
	if b.Count() != 0 {
		t.Fatal("acknowledged buffer was not released")
	}
}

func TestSummaryKeepsBillingBoundariesAndUnknowns(t *testing.T) {
	now := time.Now()
	rules := &AggregationRules{Revision: "rules-1", Models: []ModelRule{{Provider: "p", Model: "m", Above: []int64{200}}}}
	var b minuteBuffer
	base := usage.Record{Provider: "p", Model: "m", Input: 200, Output: 1, Status: 200}
	for _, change := range []func(*usage.Record){
		func(*usage.Record) {},
		func(r *usage.Record) { r.CacheRead = 1; r.Status = 503; r.HandedOn = true },
		func(r *usage.Record) { r.CacheUnknown = true },
		func(r *usage.Record) { r.Input = 0; r.Output = 0 },
		func(r *usage.Record) { r.TierServed = "priority" },
	} {
		r := base
		change(&r)
		if err := b.Add(r, now, rules); err != nil {
			t.Fatal(err)
		}
	}
	b.Seal(now, true)
	s, _ := b.First()
	if len(s.Groups) != 4 {
		t.Fatalf("mixed incompatible groups: %+v", s.Groups)
	}
	var attempts, requests int64
	for _, g := range s.Groups {
		attempts += g.Attempts
		requests += g.Requests
		if g.ContextTier == "above:200" && (g.Failed != 1 || g.HandedOn != 1 || g.Requests != 0) {
			t.Fatal("handoff attempts were counted as user requests")
		}
		if g.ContextTier == "unclassified" && g.ServiceTier == "" && (g.Attempts != 2 || g.CacheUnknownCalls != 1 || g.ZeroTokenCalls != 1) {
			t.Fatal("unknown usage was priced as ordinary context")
		}
	}
	if attempts != 5 || requests != 4 {
		t.Fatal("attempt/request totals disagree")
	}
	// Rule changes within the minute must not merge old and new classifications.
	var c minuteBuffer
	c.Add(base, now, rules)
	next := &AggregationRules{Revision: "rules-2", Models: rules.Models}
	c.Add(base, now, next)
	c.Seal(now, true)
	s, _ = c.First()
	if len(s.Groups) != 2 {
		t.Fatal("mixed rules revisions")
	}
}

func TestMinuteBufferConcurrentAndBounded(t *testing.T) {
	var b minuteBuffer
	now := time.Now()
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			for range 100 {
				if err := b.Add(usage.Record{Provider: "p", Model: "m", Input: 1, Status: 200}, now, nil); err != nil {
					t.Error(err)
				}
			}
		})
	}
	wg.Wait()
	b.Seal(now, true)
	s, _ := b.First()
	if len(s.Groups) != 1 || s.Groups[0].Attempts != 2000 {
		t.Fatal("lost concurrent increments")
	}
	b.Saved(s.ID)
	for i := range maxSummaryGroups {
		if err := b.Add(usage.Record{Provider: "p", Model: fmt.Sprint(i), Input: 1}, now, nil); err != nil {
			t.Fatal(err)
		}
	}
	b.Seal(now, true)
	if err := b.Add(usage.Record{Provider: "p", Model: "overflow"}, now, nil); err == nil {
		t.Fatal("frozen memory was not included in the buffer limit")
	}
	for {
		s, ok := b.First()
		if !ok {
			break
		}
		if len(s.Groups) > groupsPerSummary {
			t.Fatal("unbounded packet")
		}
		b.Saved(s.ID)
	}
	if b.Count() != 0 {
		t.Fatal("bounded buffer leaked groups")
	}
}

func TestRulesRejectAmbiguousOrInvalidBoundaries(t *testing.T) {
	for _, rules := range []AggregationRules{
		{},
		{Revision: "v", Models: []ModelRule{{Provider: "p", Model: "m"}}},
		{Revision: "v", Models: []ModelRule{{Provider: "p", Model: "m", Above: []int64{200, 100}}}},
		{Revision: "v", Models: []ModelRule{{Provider: "p", Model: "m", Above: []int64{0}}}},
		{Revision: "v", Models: []ModelRule{{Provider: "p", Model: "m"}, {Provider: "p", Model: "m"}}},
	} {
		if rules.Validate() == nil {
			t.Fatalf("accepted invalid rules: %+v", rules)
		}
	}
	if err := (AggregationRules{Revision: "v", Models: []ModelRule{{Provider: "p", Model: "m", Above: []int64{200, 400}}}}).Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestSummaryPacketsFitDurableQueueWithMaximumLabels(t *testing.T) {
	var b minuteBuffer
	now := time.Now()
	label := strings.Repeat("\\", 255)
	for i := range groupsPerSummary + 1 {
		r := usage.Record{Agent: label, Provider: label, Model: label, Served: label + string(rune('a'+i)), TierServed: label, Input: 1}
		if err := b.Add(r, now, nil); err != nil {
			t.Fatal(err)
		}
	}
	b.Seal(now, true)
	q, err := OpenQueue(t.TempDir(), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	for {
		s, ok := b.First()
		if !ok {
			break
		}
		payload, _ := json.Marshal(s)
		if err = q.Put(Item{ID: s.ID, Kind: "usage", Identity: Identity{"device", "alice"}, Payload: payload}); err != nil {
			t.Fatal(err)
		}
		b.Saved(s.ID)
	}
	if n, _ := q.Count(); n != 2 {
		t.Fatal("oversized minute was not split into bounded packets")
	}
}

func BenchmarkMinuteAggregation(b *testing.B) {
	for _, size := range []int{1, 4096} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			rules := &AggregationRules{Revision: "v"}
			for i := range size {
				rules.Models = append(rules.Models, ModelRule{Provider: "p", Model: fmt.Sprint(i), Above: []int64{200000}})
			}
			r := usage.Record{Provider: "p", Model: fmt.Sprint(size - 1), Input: 100, Output: 10}
			now := time.Now()
			var buffer minuteBuffer
			b.ReportAllocs()
			b.ResetTimer()
			for range b.N {
				if err := buffer.Add(r, now, rules); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
