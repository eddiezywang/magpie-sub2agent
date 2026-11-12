package accounting

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/testenv"
	"github.com/yetone/magpie/internal/usage"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func TestRuntimeDoesNotWaitForCollectorOrCaptureBodies(t *testing.T) {
	arrived := make(chan struct{}, 1)
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case arrived <- struct{}{}:
		default:
		}
		select {
		case <-release:
		case <-r.Context().Done():
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	defer close(release)
	r, err := New(t.TempDir(), Options{LegacyEnabled: true, UsageEnabled: true, LegacyURL: srv.URL + "/events", UsageURL: srv.URL + "/usage/events"}, "test")
	if err != nil {
		t.Fatal(err)
	}
	stop := r.Serve()
	defer stop()
	select {
	case <-arrived:
	case <-time.After(5 * time.Second):
		t.Fatal("collector was not contacted")
	}
	if r.Bodies() != usage.NoBodies || r.Begin(usage.Request{}) != nil {
		t.Fatal("numeric reporting captured model requests")
	}
	r.Ledger(usage.Record{Time: time.Now(), Model: "m", Provider: "test", Input: 10, Output: 2, Status: 200, BodyIn: "SECRET"})
	if got := r.queue.Pending("usage", 200); len(got) != 1 {
		t.Fatal("collector blocked local usage enqueue")
	}
	stop()
	if r.Snapshot().Pending == 0 {
		t.Fatal("shutdown discarded undelivered events")
	}
}

func TestRuntimeKeepsLegacyWorkingWhenUsageServerIsOld(t *testing.T) {
	var legacy atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/events" {
			legacy.Add(1)
		}
		w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()
	r, err := New(t.TempDir(), Options{LegacyEnabled: true, UsageEnabled: true, LegacyURL: srv.URL + "/events", UsageURL: srv.URL + "/usage/events"}, "test")
	if err != nil {
		t.Fatal(err)
	}
	r.legacy("desktop_proxy_start")
	r.queue.Put(item("pending-usage", "usage"))
	r.Flush(context.Background())
	if legacy.Load() != 1 || len(r.queue.Pending("legacy", 1)) != 0 || len(r.queue.Pending("usage", 200)) != 1 {
		t.Fatal("usage capability failure broke old telemetry or dropped usage")
	}
}

func TestRuntimeDisableClearsOnlyItsOwnPlaneAndRetainsIdentity(t *testing.T) {
	dir := t.TempDir()
	options := Options{LegacyEnabled: true, UsageEnabled: true, LegacyURL: "http://127.0.0.1/events", UsageURL: "http://127.0.0.1/usage/events"}
	r, err := New(dir, options, "test")
	if err != nil {
		t.Fatal(err)
	}
	r.queue.Put(item("usage-event", "usage"))
	r.queue.Put(item("legacy-event", "legacy"))
	options.UsageEnabled = false
	next, err := New(dir, options, "test")
	if err != nil {
		t.Fatal(err)
	}
	if next.identity.InstallID != r.identity.InstallID || len(next.queue.Pending("usage", 200)) != 0 || len(next.queue.Pending("legacy", 1)) != 1 {
		t.Fatal("disable or persistent install identity broken")
	}
	t.Setenv("CB_PROXY_TELEMETRY", "0")
	t.Setenv("CB_PROXY_TELEMETRY_URL", "http://127.0.0.1/custom-events")
	options = Defaults().WithEnv()
	if options.LegacyEnabled || options.UsageEnabled || options.LegacyURL != "http://127.0.0.1/custom-events" {
		t.Fatal("old environment override changed meaning")
	}
	for _, value := range []string{"", "0", " FALSE ", "No", "off"} {
		t.Setenv("CB_PROXY_TELEMETRY", value)
		if Defaults().WithEnv().LegacyEnabled {
			t.Fatalf("legacy opt-out %q ignored", value)
		}
	}
}

func TestRejectedEventsAreArchivedBeforeLeavingPending(t *testing.T) {
	dir := t.TempDir()
	q, err := OpenQueue(dir, 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	q.Put(item("a", "usage"))
	q.Put(item("b", "usage"))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/healthz" {
			json.NewEncoder(w).Encode(map[string]any{"usage_schemas": []string{UsageSchema}})
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"ok": true, "schema": UsageSchema, "accepted_ids": []string{"b"}, "rejected_ids": []string{"a"}})
	}))
	defer srv.Close()
	s := Sender{UsageURL: srv.URL + "/usage/events", Reject: q.Reject}
	ids, err := s.Send(context.Background(), q.Pending("usage", 200))
	if err != nil {
		t.Fatal(err)
	}
	if err = q.Ack(ids); err != nil {
		t.Fatal(err)
	}
	if n, _ := q.Count(); n != 0 {
		t.Fatal("poison event blocked the queue")
	}
	if _, err = os.Stat(filepath.Join(dir, "rejected", "a.json")); err != nil {
		t.Fatal("rejected event was lost instead of archived")
	}
}
