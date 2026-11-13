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
	"github.com/yetone/magpie/internal/provider"
)

func TestIntranetOmitsLibraryAndItsAssets(t *testing.T) {
	if len(provider.Presets()) != 0 {
		t.Fatal("upstream vendor presets must not appear in the internal distribution")
	}
	registeredSessions := false
	registeredAccounting := false
	for _, m := range pluginrt.Registered() {
		if m.ID == "accounting" {
			registeredAccounting = m.RestartOnConfig && m.Essential && m.Schema() != nil
		}
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
	if !registeredAccounting {
		t.Fatal("intranet accounting must expose settings and apply changes immediately")
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
	for _, path := range []string{"/api/masking/summary", "/api/masking/records", "/api/privacy-model", "/plugins/redact/client.js"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", path, nil))
		if r.Code != 404 {
			t.Fatalf("removed masking route %s: %d", path, r.Code)
		}
	}
	for _, path := range []string{"/api/settings/redact-route", "/api/settings/redact-rule", "/api/settings/redact-rules", "/api/settings/redact-actions", "/api/settings/redact-allow", "/api/masking/try", "/api/privacy-model"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("POST", path, strings.NewReader(`{}`)))
		if r.Code != 404 {
			t.Fatalf("removed masking mutation %s: %d", path, r.Code)
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
	if strings.Contains(string(page), `plugins/redact/`) || strings.Contains(string(page), `data-view="masking"`) || strings.Contains(string(page), `id="redactList"`) {
		t.Fatal("masking is still in packed HTML")
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
