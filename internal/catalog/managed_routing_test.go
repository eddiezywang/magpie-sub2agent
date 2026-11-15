//go:build intranet

package catalog

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
)

func TestManagedRoutingRefreshPreservesCacheAndExpiresPromotions(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	var good atomic.Bool
	good.Store(true)
	doc := managedRouting{Revision: "fixture", Expires: time.Now().Add(time.Hour), Models: []managedRate{{Provider: "sub2agent-workbuddy*", Model: "hy4free", Score: 0}, {Provider: "sub2agent-workbuddy*", Model: "glm-5.3-flash-maas", Score: 1}, {Provider: "sub2agent-tigcodingplan*", Model: "glm-*", Score: 1}, {Provider: "sub2agent-workbuddy*", Model: "expired", Score: 0, Until: time.Now().Add(-time.Hour)}}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !good.Load() {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(doc)
	}))
	defer srv.Close()
	old := managedRoutingURL
	managedRoutingURL = srv.URL
	t.Cleanup(func() { managedRoutingURL = old })
	if err := refreshManagedRouting(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, m := range []struct {
		p, m  string
		score float64
	}{{"sub2agent-workbuddy#account", "hy4free", 0}, {"sub2agent-workbuddy", "glm-5.3-flash-maas-fixture", 1}, {"sub2agent-tigcodingplan-2", "glm-5.2-zp", 1}} {
		if score, ok := RoutingScore(m.p, m.m); !ok || score != m.score {
			t.Fatalf("missing managed rank: %+v", m)
		}
	}
	if _, ok := RoutingScore("sub2agent-workbuddy", "expired"); ok {
		t.Fatal("expired promotion used")
	}
	good.Store(false)
	if err := refreshManagedRouting(context.Background()); err == nil {
		t.Fatal("outage hidden")
	}
	if _, ok := RoutingScore("sub2agent-workbuddy", "hy4free"); !ok {
		t.Fatal("outage cleared last valid cache")
	}
	doc.Expires = time.Now().Add(-time.Hour)
	raw, _ := json.Marshal(doc)
	os.WriteFile(filepath.Clean(managedRoutingPath()), raw, 0600)
	if _, ok := RoutingScore("sub2agent-workbuddy", "hy4free"); ok {
		t.Fatal("expired catalog used")
	}
}
