//go:build intranet && packedassets

package gui

import (
	"net/http/httptest"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/library"
	"github.com/yetone/magpie/internal/pluginrt"
)

func TestIntranetOmitsLibraryAndItsAssets(t *testing.T) {
	registeredSessions := false
	for _, m := range pluginrt.Registered() {
		if m.ID == "sessions" {
			registeredSessions = true
		}
		if slices.Contains(distribution.Removed, m.ID) {
			t.Fatalf("registered omitted module %s", m.ID)
		}
	}
	if !registeredSessions {
		t.Fatal("Sessions must remain registered")
	}
	for _, name := range []string{"i18n.js", "client.js", "sessions.css", "settings.js"} {
		if _, err := assets.ReadFile("assets/plugins/sessions/" + name); err != nil {
			t.Fatal(err)
		}
	}
	if res, err := library.Sync(); err != nil || len(res.Changed) != 0 {
		t.Fatalf("library sync: %v %v", res, err)
	}
	h := builtinHome(t)
	for _, path := range []string{"/api/library", "/plugins/library/client.js", "/plugins/redact/xq_light.webm"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 404 {
			t.Fatalf("%s: %d", path, r.Code)
		}
	}
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest("GET", "/boot.js", nil))
	if r.Code != 200 || !strings.Contains(r.Body.String(), `"intranet":true`) {
		t.Fatalf("boot: %d %s", r.Code, r.Body.String())
	}
	for _, id := range distribution.Removed {
		if !slices.Contains(builtinsOff(builtinsState()), id) {
			t.Fatalf("feature visible: %s", id)
		}
	}
	page, err := assets.ReadFile("assets/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(page), `src="plugins/library/`) || strings.Contains(string(page), `href="plugins/library/`) {
		t.Fatal("library still loaded")
	}
	for _, match := range regexp.MustCompile(`(?:src|href)="([^"]+\.(?:js|css))"`).FindAllStringSubmatch(string(page), -1) {
		name := match[1]
		if name == "boot.js" || strings.HasPrefix(name, "/wails/") {
			continue
		}
		if _, err := assets.ReadFile("assets/" + name); err != nil {
			t.Errorf("index references missing asset %s: %v", name, err)
		}
	}
}
