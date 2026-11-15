//go:build intranet

package gui

import (
	"bytes"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestWorkspaceDeletedGroupDoesNotRewriteAgent(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	t.Setenv("CODEX_HOME", filepath.Join(home, ".codex"))
	config := filepath.Join(home, ".codex", "config.toml")
	if err := os.MkdirAll(filepath.Dir(config), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, []byte("model = \"m1\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := provider.Save(provider.Provider{ID: "workspace-save", Key: "synthetic", Chat: "http://127.0.0.1:1/v1", Models: []string{"m1"}}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SaveGroup(provider.Group{ID: "workspace-save", Name: "Workspace save", Members: []string{"workspace-save/m1"}}); err != nil {
		t.Fatal(err)
	}
	h := Handler(nil, nil)
	call := func(body string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("POST", "/api/set", strings.NewReader(body)))
		return w
	}
	// Existing groups still use the native writer.
	if w := call(`{"agent":"codex","field":"model","value":"group/workspace-save"}`); w.Code != 200 {
		t.Fatalf("existing group: %d %s", w.Code, w.Body)
	}
	if err := provider.DeleteGroup("workspace-save"); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(config)
	if err != nil {
		t.Fatal(err)
	}
	w := call(`{"agent":"codex","field":"model","value":"group/workspace-save"}`)
	if w.Code < 400 || !strings.Contains(w.Body.String(), "Routing group is no longer available") {
		t.Fatalf("deleted group was not rejected: %d %s", w.Code, w.Body)
	}
	after, err := os.ReadFile(config)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("rejected group changed Agent configuration: %v", err)
	}
}
