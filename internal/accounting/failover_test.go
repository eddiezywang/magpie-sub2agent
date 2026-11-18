package accounting

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestCollectorPriorityFailoverAndQueueRetention(t *testing.T) {
	collector := func() (*httptest.Server, *atomic.Bool, *atomic.Int32) {
		var down atomic.Bool
		var writes atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if down.Load() {
				w.WriteHeader(http.StatusServiceUnavailable)
				return
			}
			if r.URL.Path == "/events" {
				writes.Add(1)
			}
			_, _ = w.Write([]byte(`{"ok":true}`))
		}))
		t.Cleanup(server.Close)
		return server, &down, &writes
	}
	private, privateDown, privateWrites := collector()
	public, publicDown, publicWrites := collector()
	runtime, err := New(t.TempDir(), Options{LegacyEnabled: true, LegacyURL: private.URL + "/events"}, "test")
	if err != nil {
		t.Fatal(err)
	}
	runtime.failover = &collectorFailover{public: Sender{LegacyURL: public.URL + "/events"}}
	put := func(id string) {
		t.Helper()
		if err := runtime.queue.Put(item(id, "legacy")); err != nil {
			t.Fatal(err)
		}
	}
	pending := func() int { return len(runtime.queue.Pending("legacy", 16)) }
	put("private")
	runtime.Flush(context.Background())
	if privateWrites.Load() != 1 || publicWrites.Load() != 0 || pending() != 0 {
		t.Fatal("available primary must receive the event exclusively")
	}
	privateDown.Store(true)
	put("public")
	runtime.Flush(context.Background())
	if publicWrites.Load() != 1 || pending() != 0 {
		t.Fatal("primary delivery failure must fall back to public")
	}
	publicDown.Store(true)
	put("offline")
	runtime.Flush(context.Background())
	if pending() != 1 {
		t.Fatal("when both collectors fail the event must stay on disk")
	}
	privateDown.Store(false)
	runtime.failover.retryAfter = time.Time{}
	runtime.Flush(context.Background())
	if privateWrites.Load() != 2 || publicWrites.Load() != 1 || pending() != 0 {
		t.Fatal("recovered primary must receive the queued event")
	}
}
