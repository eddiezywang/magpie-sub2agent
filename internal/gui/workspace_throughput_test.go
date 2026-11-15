package gui

import (
	"context"
	"encoding/json"
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/gateway"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWorkspaceThroughputOwnerAndUnavailable(t *testing.T) {
	if !distribution.Internal {
		t.Skip("internal endpoint")
	}
	served.Store(nil)
	owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/magpie/throughput" {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(gateway.New().Throughput())
	}))
	defer owner.Close()
	t.Setenv("MAGPIE_ADDR", strings.TrimPrefix(owner.URL, "http://"))
	mux := http.NewServeMux()
	workspaceThroughputRoutes(mux)
	read := func() gateway.ThroughputState {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/gateway/throughput", nil))
		var out gateway.ThroughputState
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	if out := read(); out.Status != "ok" || len(out.Total.Points) != 180 {
		t.Fatalf("owner data missing: %+v", out)
	}
	owner.Close()
	if out := read(); out.Status != "unavailable" {
		t.Fatal("missing owner presented as idle")
	}
	t.Setenv("MAGPIE_ADDR", "192.0.2.1:8989")
	if out := read(); out.Status != "unavailable" {
		t.Fatal("nonloopback owner accepted")
	}
}

func TestWorkspaceThroughputKeepsSessionsSpeedsContract(t *testing.T) {
	if !distribution.Internal {
		t.Skip("internal endpoint")
	}
	previous := served.Load()
	served.Store(gateway.New())
	t.Cleanup(func() { served.Store(previous) })
	mux := http.NewServeMux()
	workspaceThroughputRoutes(mux)
	sessionManageRoutes(mux, nil)
	// Reading or initializing workspace statistics must not manufacture a
	// session or replace the existing speeds endpoint with a dashboard object.
	for _, endpoint := range []string{"/api/speeds", "/api/gateway/throughput", "/api/speeds"} {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", endpoint, nil))
		if w.Code != 200 {
			t.Fatalf("%s: %d", endpoint, w.Code)
		}
		if endpoint == "/api/speeds" {
			if strings.TrimSpace(w.Body.String()) != "[]" {
				t.Fatalf("workspace read changed empty session speeds: %s", w.Body)
			}
		} else {
			var out gateway.ThroughputState
			if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil || len(out.Total.Points) != 180 {
				t.Fatalf("workspace sequence missing: %v", err)
			}
		}
	}
}

func TestWorkspaceThroughputRejectsUnsupportedOwner(t *testing.T) {
	for _, body := range []string{`{"version":0}`, `{"version":1,"epoch":1,"windowSeconds":180,"total":{"points":[]}}`, `invalid`} {
		t.Run(body, func(t *testing.T) {
			owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte(body)) }))
			defer owner.Close()
			t.Setenv("MAGPIE_ADDR", strings.TrimPrefix(owner.URL, "http://"))
			if _, ok := gateway.OwnerThroughput(context.Background()); ok {
				t.Fatal("unsupported/malformed owner treated as idle")
			}
		})
	}
	owner := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer owner.Close()
	t.Setenv("MAGPIE_ADDR", strings.TrimPrefix(owner.URL, "http://"))
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Millisecond)
	defer cancel()
	if _, ok := gateway.OwnerThroughput(ctx); ok {
		t.Fatal("timed out owner treated as idle")
	}
}
