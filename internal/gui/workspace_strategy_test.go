//go:build intranet

package gui

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestWorkspaceDefaultAndStrategyPreserveExplicitChoices(t *testing.T) {
	home := t.TempDir()
	for _, name := range []string{"HOME", "USERPROFILE"} {
		t.Setenv(name, home)
	}
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("CODEX_HOME", filepath.Join(home, ".codex"))
	if err := os.MkdirAll(filepath.Join(home, ".codex"), 0700); err != nil {
		t.Fatal(err)
	}
	cfg := filepath.Join(home, ".codex", "config.toml")
	if err := os.WriteFile(cfg, []byte(""), 0600); err != nil {
		t.Fatal(err)
	}
	if err := provider.Save(provider.Provider{ID: "plan", Key: "fixture", Chat: "http://127.0.0.1:1/v1", Models: []string{"glm-5.3-flash-zp", "doubao-seed-2.1-pro"}}); err != nil {
		t.Fatal(err)
	}
	h := Handler(nil, nil)
	call := func(path, body string, want int) stateJSON {
		t.Helper()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("POST", path, strings.NewReader(body)))
		if rec.Code != want {
			t.Fatalf("%s status %d: %s", path, rec.Code, rec.Body.String())
		}
		var s stateJSON
		if want == 200 {
			if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
				t.Fatal(err)
			}
		}
		return s
	}
	model := func(s stateJSON) string {
		for _, a := range s.Agents {
			if a.ID == "codex" {
				for _, f := range a.Fields {
					if f.Key == "model" {
						return f.Value
					}
				}
			}
		}
		t.Fatal("no Codex model")
		return ""
	}
	first := model(call("/api/agents/connect/codex", "{}", 200))
	if !strings.HasPrefix(first, "group/") {
		t.Fatalf("no Flash default: %s", first)
	}
	call("/api/workspace/strategy", `{"agent":"codex","kind":"flagship-first","expected":"stale"}`, 400)
	if next := model(call("/api/agents/connect/codex", "{}", 200)); next != first {
		t.Fatalf("reconnection replaced preference: %s", next)
	}
	body, _ := json.Marshal(map[string]string{"agent": "codex", "kind": "flagship-first", "expected": first})
	flagship := model(call("/api/workspace/strategy", string(body), 200))
	if flagship == first {
		t.Fatal("strategy did not change")
	}
	call("/api/set", `{"agent":"codex","field":"model","value":"plan/glm-5.3-flash-zp"}`, 200)
	if next := model(call("/api/agents/connect/codex", "{}", 200)); next != "plan/glm-5.3-flash-zp" {
		t.Fatalf("explicit model replaced: %s", next)
	}
}
