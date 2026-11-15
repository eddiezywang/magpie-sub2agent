package gui

import (
	"encoding/json"
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/gateway"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
