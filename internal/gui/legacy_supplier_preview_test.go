package gui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/distribution"
)

func TestLegacySupplierPreviewRoute(t *testing.T) {
	mux := http.NewServeMux()
	legacySupplierPreviewRoutes(mux)
	read := func() *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/legacy-suppliers", nil))
		return w
	}
	if !distribution.Internal {
		if w := read(); w.Code != http.StatusNotFound {
			t.Fatalf("upstream route: %d", w.Code)
		}
		return
	}
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	dir := filepath.Join(h, ".sub2agent", "data")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "proxy.json")
	raw := []byte(`{"version":1,"desktop":{"sources":[{"id":"one","kind":"subscription","provider":"workbuddy","displayName":"WorkBuddy","secretRef":"secret:private"}]}}`)
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	w := read()
	if w.Code != 200 {
		t.Fatalf("preview: %d %s", w.Code, w.Body)
	}
	var result struct {
		Found   bool `json:"found"`
		Sources []struct {
			Icon string `json:"icon"`
		} `json:"sources"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || !result.Found || len(result.Sources) != 1 || result.Sources[0].Icon != "workbuddy-color" {
		t.Fatalf("bad preview: %s", w.Body)
	}
	if strings.Contains(w.Body.String(), "secret:private") {
		t.Fatal("secret reference exposed")
	}
	if err := os.WriteFile(file, []byte(`{"version":`), 0600); err != nil {
		t.Fatal(err)
	}
	if w := read(); w.Code != 500 {
		t.Fatalf("corrupt data presented as empty: %d", w.Code)
	}
}
