package gateway

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

const rescueMaas = "glm-5.3-flash-maas-fixture"
const rescueSummary = `{"role":"system","content":"You are a helpful AI assistant tasked with summarizing conversations."},{"role":"user","content":"Your task is to create a detailed summary of the conversation so far"}`

func TestWorkBuddyCompactRescueScope(t *testing.T) {
	fresh(t)
	c := candidate{p: provider.Provider{ID: "sub2agent-workbuddy", Models: []string{rescueMaas, "hy4free"}, Contexts: map[string]int{"hy4free": 960000}}, model: rescueMaas}
	body := []byte(`{"model":"sub2agent-workbuddy/` + rescueMaas + `","messages":[` + rescueSummary + `]}`)
	for _, status := range []int{200, 400, 401, 403, 429, 500, 503} {
		if _, ok := workBuddyCompactRescue(c, KindCompact, status, provider.Chat, body, nil); ok {
			t.Fatalf("status %d must not activate size rescue", status)
		}
	}
	for _, tc := range []struct {
		name  string
		c     candidate
		kind  string
		body  []byte
		tried []candidate
	}{
		{"ordinary turn", c, "", body, nil},
		{"only a kind mark", c, KindCompact, []byte(`{"messages":[{"role":"user","content":"fix a bug"}]}`), nil},
		{"another provider", candidate{p: provider.Provider{ID: "other", Models: c.p.Models}, model: rescueMaas}, KindCompact, body, nil},
		{"non MaaS", candidate{p: c.p, model: "Hy3"}, KindCompact, body, nil},
		{"rescue disabled", candidate{p: provider.Provider{ID: c.p.ID, Models: []string{rescueMaas}}, model: rescueMaas}, KindCompact, body, nil},
		{"already tried", c, KindCompact, body, []candidate{{p: c.p, model: "hy4free"}}},
		{"account disallows", candidate{p: provider.Provider{ID: c.p.ID, Models: c.p.Models, AccountModels: map[string][]string{"": {rescueMaas}}}, model: rescueMaas}, KindCompact, body, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, ok := workBuddyCompactRescue(tc.c, tc.kind, 413, provider.Chat, tc.body, tc.tried); ok {
				t.Fatal("unexpected rescue")
			}
		})
	}
	if got, ok := workBuddyCompactRescue(c, KindCompact, 413, provider.Chat, body, nil); !ok || got.model != "hy4free" || !got.compactRescue {
		t.Fatalf("rescue: %+v %v", got, ok)
	}
	catalogProvider := c.p
	catalogProvider.Chat, catalogProvider.Key = "http://127.0.0.1:1/v1", "fixture"
	if err := provider.Save(catalogProvider); err != nil {
		t.Fatal(err)
	}
	pluginDefault := c
	pluginDefault.p.Models = nil
	if _, ok := workBuddyCompactRescue(pluginDefault, KindCompact, 413, provider.Chat, body, nil); !ok {
		t.Fatal("a provider with a catalog list and no explicit model selection must rescue")
	}
	s := New()
	s.bodyCaps.learn(c.p.ID, 1024)
	withImage := []byte(`{"model":"hy4free","messages":[` + rescueSummary + `,{"role":"user","content":[{"type":"image_url","image_url":{"url":"data:image/png;base64,` + strings.Repeat("A", 6000) + `"}}]}]}`)
	if got, left := s.capFit(c.p, provider.Chat, "/v1/chat/completions", withImage); left != 0 || string(got) != string(withImage) {
		t.Fatal("compaction rescue must retain images despite a MaaS byte cap")
	}
}

func TestWorkBuddyCompactRescueGateway(t *testing.T) {
	for _, stream := range []bool{false, true} {
		t.Run(map[bool]string{false: "json", true: "stream"}[stream], func(t *testing.T) {
			fresh(t)
			var seen []string
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				b, _ := io.ReadAll(r.Body)
				var ask struct {
					Model  string `json:"model"`
					Stream bool   `json:"stream"`
				}
				json.Unmarshal(b, &ask)
				seen = append(seen, ask.Model)
				if ask.Model == rescueMaas && strings.Contains(string(b), "summarizing conversations") {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(413)
					io.WriteString(w, `{"error":{"type":"request_too_large","message":"MaaS request body too large"}}`)
					return
				}
				if ask.Stream {
					w.Header().Set("Content-Type", "text/event-stream")
					io.WriteString(w, strings.Replace(chatStreamSaid("ORCHID-7429"), "data: [DONE]", `data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}`+"\n\ndata: [DONE]", 1))
					return
				}
				w.Header().Set("Content-Type", "application/json")
				io.WriteString(w, strings.TrimSuffix(chatOK, "}")+`,"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}`)
			}))
			defer up.Close()
			if err := provider.Save(provider.Provider{ID: "sub2agent-workbuddy", Name: "WorkBuddy", Key: "fixture", Chat: up.URL + "/v1", Models: []string{rescueMaas, "hy4free"}, Contexts: map[string]int{"hy4free": 960000}}); err != nil {
				t.Fatal(err)
			}
			if err := provider.SaveGroup(provider.Group{Name: "Rescue", Members: []string{"sub2agent-workbuddy/" + rescueMaas}, Routing: provider.Ordered, Affinity: "session"}); err != nil {
				t.Fatal(err)
			}
			s := New()
			for _, model := range []string{"sub2agent-workbuddy/" + rescueMaas, "group/rescue"} {
				ordinary := `{"model":"` + model + `","messages":[{"role":"user","content":"continue coding"}]}`
				if code, out := postAs(t, s, "rescue-session", ordinary); code != 200 {
					t.Fatalf("initial: %d %s", code, out)
				}
				body := `{"model":"` + model + `","stream":` + map[bool]string{false: "false", true: "true"}[stream] + `,"messages":[` + rescueSummary + `]}`
				code, out := postAs(t, s, "rescue-session", body)
				route := lastRoute(s)
				if code != 200 || len(route.Tries) != 2 || route.Tries[0].Status != 413 || route.Tries[1].Model != "hy4free" || route.Kind != KindCompact {
					t.Fatalf("summary: %d %s %+v", code, out, route)
				}
				if s.resting("sub2agent-workbuddy") {
					t.Fatal("a byte cap must not rest the account")
				}
				if len(route.Usage) != 1 || route.Usage[0].Model != "hy4free" || route.Usage[0].Input != 100 || route.Usage[0].Output != 20 {
					t.Fatalf("rescue usage must belong to hy4free: %+v", route.Usage)
				}
				if code, out := postAs(t, s, "rescue-session", ordinary); code != 200 {
					t.Fatalf("continued: %d %s", code, out)
				}
				if !slices.Equal(seen[len(seen)-4:], []string{rescueMaas, rescueMaas, "hy4free", rescueMaas}) {
					t.Fatalf("summary moved main model: %v", seen)
				}
			}
		})
	}
}

func TestWorkBuddyCompactRescueBudget(t *testing.T) {
	fresh(t)
	var seen []string
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ask struct {
			Model     string `json:"model"`
			MaxTokens int    `json:"max_tokens"`
		}
		json.NewDecoder(r.Body).Decode(&ask)
		seen = append(seen, ask.Model)
		w.Header().Set("Content-Type", "application/json")
		if ask.Model == rescueMaas {
			w.WriteHeader(413)
			io.WriteString(w, `{"error":{"type":"request_too_large","message":"body too large"}}`)
			return
		}
		if ask.Model != "hy4free" || ask.MaxTokens != 32768 {
			t.Errorf("summary rescue needs room for thinking: %+v", ask)
		}
		io.WriteString(w, chatOK)
	}))
	defer up.Close()
	if err := provider.Save(provider.Provider{ID: "sub2agent-workbuddy", Key: "fixture", Chat: up.URL + "/v1", Models: []string{rescueMaas, "hy4free", "Deepseek-V4-Flash"}}); err != nil {
		t.Fatal(err)
	}
	code, out := postAs(t, New(), "rescue-budget", `{"model":"sub2agent-workbuddy/`+rescueMaas+`","max_tokens":1500,"messages":[`+rescueSummary+`]}`)
	if code != 200 || !slices.Equal(seen, []string{rescueMaas, "hy4free"}) {
		t.Fatalf("compact: %d %s, models %v", code, out, seen)
	}
}

func TestWorkBuddyCompactRescueNoPaidFallback(t *testing.T) {
	fresh(t)
	c := candidate{p: provider.Provider{ID: "sub2agent-workbuddy", Models: []string{rescueMaas, "hy4free", "Deepseek-V4-Flash"}}, model: rescueMaas}
	body := []byte(`{"messages":[` + rescueSummary + `]}`)
	if _, ok := workBuddyCompactRescue(c, KindCompact, 413, provider.Chat, body, []candidate{{p: c.p, model: "hy4free"}}); ok {
		t.Fatal("must not insert a paid fallback after hy4free")
	}
	for _, proto := range []provider.Protocol{provider.Chat, provider.Responses, provider.Anthropic} {
		high := []byte(`{"max_tokens":64000,"max_completion_tokens":64000,"max_output_tokens":64000}`)
		if string(workBuddyCompactBudget(proto, high)) != string(high) {
			t.Fatal("larger output budgets must be preserved")
		}
	}
}
