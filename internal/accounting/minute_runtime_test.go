package accounting

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/usage"
)

func TestMinuteRuntimeAvoidsPerRequestDiskAndReplaysUsername(t *testing.T) {
	t.Setenv("USERNAME", "alice")
	var posts atomic.Int32
	var received struct {
		Schema string `json:"schema"`
		Identity
		Summaries []MinuteSummary `json:"summaries"`
		Events    json.RawMessage `json:"events"`
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/healthz" {
			json.NewEncoder(w).Encode(map[string]any{"usage_schemas": []string{SummarySchema}})
			return
		}
		if err := json.NewDecoder(req.Body).Decode(&received); err != nil {
			t.Error(err)
		}
		posts.Add(1)
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "schema": SummarySchema, "accepted_ids": []string{received.Summaries[0].ID}})
	}))
	defer srv.Close()
	dir := t.TempDir()
	o := Options{UsageEnabled: true, UsageURL: srv.URL + "/usage/events"}
	r, err := New(dir, o, "test")
	if err != nil {
		t.Fatal(err)
	}
	// Keep the live HTTP worker out of this deterministic crash/replay fixture.
	r.running = true
	now := time.Now()
	for range 1000 {
		r.Ledger(usage.Record{Time: now, Provider: "p", Model: "m", Input: 10, Output: 2, Status: 200})
	}
	files, _ := os.ReadDir(filepath.Join(dir, "accounting-outbox"))
	if len(files) != 0 || r.minutes.Count() != 1 {
		t.Fatal("per-request files were created")
	}
	crashed, err := New(dir, o, "test")
	if err != nil {
		t.Fatal(err)
	}
	if crashed.minutes.Count() != 0 || crashed.Snapshot().Pending != 0 {
		t.Fatal("unsealed minute unexpectedly persisted")
	}
	r.persistMinutes(now.Add(2*time.Minute), false)
	pending := r.queue.Pending("summary", 10)
	if len(pending) != 1 || r.minutes.Count() != 0 {
		t.Fatal("minute did not produce exactly one durable summary")
	}
	stableID := pending[0].ID
	// The stored owner survives a change in login before replay.
	t.Setenv("USERNAME", "bob")
	reopened, err := New(dir, o, "test")
	if err != nil {
		t.Fatal(err)
	}
	reopened.Flush(context.Background())
	if posts.Load() != 1 || received.Username != "alice" || received.InstallID != r.identity.InstallID || received.Schema != SummarySchema || received.Events != nil || len(received.Summaries) != 1 || received.Summaries[0].ID != stableID {
		t.Fatalf("wrong identity/protocol on replay: %+v", received)
	}
	g := received.Summaries[0].Groups[0]
	if g.Attempts != 1000 || g.Input != 10000 || g.Output != 2000 {
		t.Fatalf("wrong minute totals: %+v", g)
	}
	if reopened.Snapshot().Pending != 0 {
		t.Fatal("accepted summary was not reclaimed")
	}
}

func TestMinutePersistenceFailureRetainsFrozenIdentity(t *testing.T) {
	r, err := New(t.TempDir(), Options{}, "test")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	r.minutes.Add(usage.Record{Provider: "p", Model: "m", Input: 1}, now, nil)
	r.queue.limit = 1
	r.persistMinutes(now, true)
	frozen, ok := r.minutes.First()
	if !ok || r.Snapshot().QueueFailures != 1 {
		t.Fatal("disk failure silently lost the summary")
	}
	r.minutes.Add(usage.Record{Provider: "p", Model: "m", Input: 2}, now, nil)
	r.queue.limit = 1 << 20
	r.persistMinutes(now, true)
	items := r.queue.Pending("summary", 10)
	if len(items) != 2 {
		t.Fatal("failed packet was mutated or overwritten by later usage")
	}
	found := false
	for _, it := range items {
		if it.ID == frozen.ID {
			found = true
		}
	}
	if !found || r.minutes.Count() != 0 {
		t.Fatal("retry changed summary identity")
	}
}

func TestSummaryRequiresV3AndExplicitAcknowledgement(t *testing.T) {
	var mode atomic.Int32
	var posts atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/healthz" {
			schema := UsageSchema
			if mode.Load() > 0 {
				schema = SummarySchema
			}
			json.NewEncoder(w).Encode(map[string]any{"usage_schemas": []string{schema}})
			return
		}
		posts.Add(1)
		ack := map[string]any{"ok": true, "schema": SummarySchema}
		switch mode.Load() {
		case 1:
			ack["stored"] = 1
			ack["schema"] = UsageSchema
		case 2:
			ack["accepted_ids"] = []string{"foreign"}
		case 3:
			ack["duplicate_ids"] = []string{"packet"}
		}
		json.NewEncoder(w).Encode(ack)
	}))
	defer srv.Close()
	s := Sender{UsageURL: srv.URL + "/usage/events"}
	it := item("packet", "summary")
	it.Identity.Username = "alice"
	if _, err := s.Send(context.Background(), []Item{it}); err == nil || posts.Load() != 0 {
		t.Fatal("v3 was sent to a v2 collector")
	}
	for _, m := range []int32{1, 2} {
		mode.Store(m)
		if _, err := s.Send(context.Background(), []Item{it}); err == nil {
			t.Fatal("invalid acknowledgement accepted")
		}
	}
	mode.Store(3)
	if ids, err := s.Send(context.Background(), []Item{it}); err != nil || len(ids) != 1 || ids[0] != "packet" {
		t.Fatalf("duplicate retry was not acknowledged: %v %v", ids, err)
	}
	it.Identity.Username = ""
	if _, err := s.Send(context.Background(), []Item{it}); err == nil {
		t.Fatal("username omitted from summary")
	}
}

func TestRulesRefreshPersistsAndKeepsLastValidClassification(t *testing.T) {
	var mode atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path != "/usage/aggregation-rules" {
			t.Error("wrong rules endpoint")
		}
		if mode.Load() == 2 {
			w.WriteHeader(503)
			return
		}
		above := 200
		if mode.Load() == 1 {
			above = 100
		}
		json.NewEncoder(w).Encode(map[string]any{"revision": "r1", "models": []map[string]any{{"provider": "p", "model": "m", "service_tier": "", "above": []int{above}}}})
	}))
	defer srv.Close()
	dir := t.TempDir()
	r, err := New(dir, Options{UsageURL: srv.URL + "/usage/events"}, "test")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.refreshRules(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, m := range []int32{1, 2} {
		mode.Store(m)
		if err = r.refreshRules(context.Background()); err == nil {
			t.Fatal("invalid rules refresh succeeded")
		}
		if r.rules.Revision != "r1" || r.rules.Models[0].Above[0] != 200 {
			t.Fatal("last valid rules were changed")
		}
	}
	reopened, err := New(dir, Options{}, "test")
	if err != nil || reopened.rules == nil || reopened.rules.Models[0].Above[0] != 200 {
		t.Fatal("rules did not survive restart")
	}
	if err = os.WriteFile(filepath.Join(dir, "accounting-rules.json"), []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	mode.Store(0)
	// A fresh process preserves a corrupt cache before replacing it.
	next, err := New(dir, Options{UsageURL: srv.URL + "/usage/events"}, "test")
	if err != nil {
		t.Fatal(err)
	}
	if err = next.refreshRules(context.Background()); err != nil {
		t.Fatal(err)
	}
	bad, _ := filepath.Glob(filepath.Join(dir, "accounting-rules.json.bad-*"))
	if len(bad) != 1 {
		t.Fatal("invalid cache was overwritten without a diagnostic copy")
	}
}

func TestMinuteCollectionConcurrentWithSealAndStop(t *testing.T) {
	r, err := New(t.TempDir(), Options{UsageEnabled: true, UsageURL: "http://127.0.0.1/usage/events"}, "test")
	if err != nil {
		t.Fatal(err)
	}
	r.running = true
	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			for range 100 {
				r.Ledger(usage.Record{Provider: "p", Model: "m", Input: 1, Status: 200})
			}
		})
	}
	wg.Go(func() {
		for range 5 {
			r.persistMinutes(time.Now(), true)
			r.Snapshot()
		}
	})
	wg.Wait()
	r.persistMinutes(time.Now(), true)
	var total int64
	for _, it := range r.queue.Pending("summary", 200) {
		var s MinuteSummary
		if err = json.Unmarshal(it.Payload, &s); err != nil {
			t.Fatal(err)
		}
		for _, g := range s.Groups {
			total += g.Attempts
		}
		if strings.Contains(string(it.Payload), "session") {
			t.Fatal("request detail was retained")
		}
	}
	if total != 1000 || r.minutes.Count() != 0 {
		t.Fatalf("lost concurrent usage: %d", total)
	}
}
