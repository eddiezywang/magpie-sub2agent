//go:build intranet

package gateway

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestCodingPlanGatewayUsesBearerAndPublicPath(t *testing.T) {
	fresh(t)
	requests := make(chan string, 8)
	up := &adaptiveVendor{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.URL.Path
		if r.URL.Path != "/public/v1/messages" || r.Header.Get("Authorization") != "Bearer fixture-key" || r.Header.Get("x-api-key") != "" {
			t.Error("Coding Plan upstream path or authentication was incorrect")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		up.ServeHTTP(w, r)
	}))
	defer srv.Close()
	p, err := provider.FromPreset("aiep-coding-plan")
	if err != nil {
		t.Fatal(err)
	}
	p.Anthropic, p.Key = srv.URL+"/public", "fixture-key"
	p.Models = []string{"claude-sonnet-4-5"}
	if err := provider.Save(p); err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []string{"/v1/messages", "/v1/chat/completions"} {
		code, body := post(t, endpoint, `{"model":"aiep-coding-plan/claude-sonnet-4-5","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}`)
		if code != http.StatusOK {
			t.Fatalf("%s: %d %s", endpoint, code, body)
		}
		select {
		case <-requests:
		default:
			t.Fatal("request never reached plan gateway")
		}
	}
}
