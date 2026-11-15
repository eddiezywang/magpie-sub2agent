package gateway

import (
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/provider"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestWorkspaceThroughputWindowAndAttribution(t *testing.T) {
	second := int64(1000)
	m := throughputMeter{now: func() time.Time { return time.Unix(second, 0) }}
	m.snapshot() // reading an idle meter must not prevent its first write
	m.add("a", "s", "p", "m1", 100, 0.5, true)
	m.add("a", "s", "q", "m2", 40, 1, true)
	second++
	out := m.snapshot()
	if out.Total.Current == nil || *out.Total.Current != 18 || len(out.Total.Points) != 180 || *out.Total.Points[179] != 90 {
		t.Fatalf("wrong aggregate: %+v", out.Total)
	}
	if len(out.Models) != 2 || len(out.Sessions) != 1 {
		t.Fatal("model switch lost attribution")
	}
	m.add("b", "s", "p", "m1", 10, 1, true)
	m.add("a", "", "p", "m1", 5, 1, true)
	second++
	out = m.snapshot()
	if len(out.Sessions) != 3 {
		t.Fatal("session keys collided")
	}
	second += 200
	out = m.snapshot()
	if *out.Total.Current != 0 || *out.Total.Peak != 21 {
		t.Fatalf("idle/peak: %+v", out.Total)
	}
	for _, v := range out.Total.Points {
		if v == nil || *v != 0 {
			t.Fatal("stale ring data")
		}
	}
}
func TestWorkspaceThroughputUnknownAndLimits(t *testing.T) {
	second := int64(1000)
	m := throughputMeter{now: func() time.Time { return time.Unix(second, 0) }}
	m.add("a", "s", "p", "m", 10, 0, false)
	second++
	out := m.snapshot()
	if out.Status != "partial" || out.Total.Current != nil || out.Total.Points[179] != nil {
		t.Fatal("unknown rate presented as numeric zero")
	}
	if out.Total.Peak != nil || out.Models[0].Peak != nil {
		t.Fatal("uncalibrated peak presented as numeric zero")
	}
	for i := 0; i < 300; i++ {
		m.add("a", time.Unix(int64(i), 0).String(), "p", "m", 1, 1, true)
	}
	second++
	out = m.snapshot()
	if !out.Truncated || len(out.Sessions) != 256 || out.OmittedSeries != 45 {
		t.Fatalf("unbounded sessions: %d omitted=%d", len(out.Sessions), out.OmittedSeries)
	}
	if out.Total.Points[179] == nil || *out.Total.Points[179] != 300 {
		t.Fatal("eviction affected total")
	}
}
func TestWorkspaceThroughputConcurrent(t *testing.T) {
	m := throughputMeter{}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				m.add("a", "s", "p", "m", 1, 1, true)
				m.snapshot()
			}
		}()
	}
	wg.Wait()
}

func TestWorkspaceThroughputBoundariesAndReset(t *testing.T) {
	second := int64(1000)
	m := throughputMeter{now: func() time.Time { return time.Unix(second, 0) }}
	first := m.snapshot()
	for _, p := range first.Total.Points {
		if p != nil {
			t.Fatal("startup history fabricated")
		}
	}
	m.add("a", "s", "p", "m", 50, 2, true)
	second++
	first = m.snapshot()
	if *first.Total.Current != 20 || *first.Total.Peak != 20 {
		t.Fatal("first five-second mean")
	}
	m.add("a", "s", "q", "m", 50, 4, true)
	second++
	secondOut := m.snapshot()
	if *secondOut.Total.Points[178] != 100 || *secondOut.Total.Points[179] != 200 || *secondOut.Total.Peak != 60 {
		t.Fatal("conversion changed previous bucket")
	}
	second += 180
	idle := m.snapshot()
	if *idle.Total.Current != 0 || *idle.Total.Peak != 60 {
		t.Fatal("ring expiration lost independent peak")
	}
	for i := 0; i < 600; i++ {
		m.add("a", "s", time.Unix(int64(i), 0).String(), "m", 1, 1, true)
	}
	bounded := m.snapshot()
	if len(bounded.Providers) != 128 || len(bounded.Models) != 512 || !bounded.Truncated {
		t.Fatal("provider/model dimensions unbounded")
	}
	second++
	if total := m.snapshot().Total.Points[179]; total == nil || *total != 600 {
		t.Fatal("dimension eviction dropped total")
	}
	other := throughputMeter{now: func() time.Time { return time.Unix(second, 0) }}
	if reset := other.snapshot(); reset.Epoch == first.Epoch || reset.Total.StartedAt == first.Total.StartedAt {
		t.Fatal("restart reused sequence identity")
	}
}

func TestWorkspaceThroughputReceivesDeliveredContent(t *testing.T) {
	second := int64(3000)
	meter := throughputMeter{now: func() time.Time { return time.Unix(second, 0) }}
	f := &inflight{agent: "codex", session: "live-test", throughput: &meter}
	l := liveBegin(f, "workspace-live-test", provider.Chat)
	l.routed("workspace-test-provider", "workspace-live-test")
	for i := 0; i < liveRateMin; i++ {
		liveRates.learn("workspace-test-provider", "workspace-live-test", 4, 8)
	}
	l.observe([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"test\"}}]}\n\n"))
	l.observe([]byte(": keepalive\n\n"))
	l.finish(false, 8)
	second++
	out := meter.snapshot()
	if out.Total.Points[179] == nil || *out.Total.Points[179] != 8 || len(out.Models) != 1 || out.Sessions[0].Agent != "codex" {
		t.Fatalf("delivered content missing: %+v", out)
	}
}
func TestWorkspaceThroughputOwnerBoundary(t *testing.T) {
	srv := New()
	remote := httptest.NewRequest("GET", "/v1/magpie/throughput", nil)
	remote.RemoteAddr = "198.51.100.1:1234"
	w := httptest.NewRecorder()
	srv.Handler().ServeHTTP(w, remote)
	// Upstream builds omit the endpoint entirely; intranet refuses LAN access.
	want := 404
	if distribution.Internal {
		want = 403
	}
	if w.Code != want {
		t.Fatalf("remote throughput status %d, want %d", w.Code, want)
	}
	if distribution.Internal {
		local := httptest.NewRequest("GET", "/v1/magpie/throughput", nil)
		local.RemoteAddr = "127.0.0.1:12345"
		w = httptest.NewRecorder()
		srv.Handler().ServeHTTP(w, local)
		if w.Code != 200 {
			t.Fatalf("local owner route unavailable: %d", w.Code)
		}
	}
}
