//go:build intranet

package provider

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCodingPlanDefaultsAndSavedAuthentication(t *testing.T) {
	azureHome(t)
	p, err := FromPreset("aiep-coding-plan")
	if err != nil {
		t.Fatal(err)
	}
	if p.Anthropic != "http://172.21.11.82/public" || p.Chat != "" || p.AuthHeader != AuthBearer {
		t.Fatalf("wrong plan defaults: %+v", p)
	}
	url, _ := tiny(p, Anthropic, "fixture-model")
	if url != "http://172.21.11.82/public/v1/messages" {
		t.Fatalf("request address = %q", url)
	}
	for _, suffix := range []string{"", "/", "/v1", "/v1/messages"} {
		p.Anthropic = "http://172.21.11.82/public" + suffix
		p.AuthHeader = AuthXAPIKey // an old or hand-edited setting cannot change this plan's authentication
		p.Key = "fixture-key"
		if err := Save(p); err != nil {
			t.Fatal(err)
		}
		saved, err := Find(p.ID)
		if err != nil {
			t.Fatal(err)
		}
		if saved.AuthHeader != AuthBearer || saved.Anthropic != "http://172.21.11.82/public" {
			t.Fatalf("saved endpoint or authentication changed: %+v", saved)
		}
		if saved.BothAuth() {
			t.Fatal("plan offers unsupported two-header authentication")
		}
	}
	// Even a probe made from an unsaved draft must not start by sending x-api-key.
	p.AuthHeader = AuthBoth
	h := AuthHeaders(p, Anthropic)
	if len(h) != 1 || h["Authorization"] != "Bearer fixture-key" {
		t.Fatalf("draft headers = %v", h)
	}
}

func TestCodingPlanRequestAndModelDiscovery(t *testing.T) {
	azureHome(t)
	requests := make(chan string, 8)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests <- r.Method + " " + r.URL.Path
		if r.Header.Get("Authorization") != "Bearer fixture-key" || r.Header.Get("x-api-key") != "" {
			t.Error("plan request did not use Bearer alone")
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/public/models":
			w.WriteHeader(http.StatusNotFound)
		case "/public/v1/models":
			w.Write([]byte(`{"data":[{"id":"claude-haiku-4-5"}]}`))
		case "/public/v1/messages":
			w.Write([]byte(`{"id":"msg_fixture","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`))
		default:
			t.Errorf("unexpected plan path: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()
	p, _ := FromPreset("aiep-coding-plan")
	p.Anthropic, p.Key = srv.URL+"/public", "fixture-key"
	models, err := p.ListAll(context.Background())
	if err != nil || len(models) != 1 {
		t.Fatalf("model discovery: %v, %v", models, err)
	}
	results := p.TestModels(context.Background(), []string{"claude-haiku-4-5"})
	if len(results) != 1 || !results[0].OK {
		t.Fatalf("plan inference: %+v", results)
	}
	for _, want := range []string{"GET /public/models", "GET /public/v1/models", "POST /public/v1/messages"} {
		select {
		case got := <-requests:
			if got != want {
				t.Fatalf("request = %s, want %s", got, want)
			}
		default:
			t.Fatalf("missing %s", want)
		}
	}
}
