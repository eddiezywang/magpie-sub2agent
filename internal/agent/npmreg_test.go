package agent

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// npmRegistryFor, npmLatest and the install and update commands prefer the
// office npm registry while it answers and fall back to npm's own when it
// doesn't.
func TestNPMRegistryPrefersTheOfficeOne(t *testing.T) {
	office := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			w.WriteHeader(200)
			return
		}
		if r.URL.Path == "/@scope/pkg" {
			w.Write([]byte(`{"dist-tags":{"latest":"2.0.0"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer office.Close()
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/latest") {
			w.Write([]byte(`{"version":"1.5.0"}`))
			return
		}
		if r.URL.Path == "/@scope/pkg" || r.URL.Path == "/plain" {
			w.Write([]byte(`{"dist-tags":{"latest":"1.5.0"}}`))
			return
		}
		http.NotFound(w, r)
	}))
	defer fallback.Close()

	oldReg, oldOn, oldURL := npmRegistry, npmIntranetOn, npmIntranet
	oldSeen, oldLatests := &npmIntranetSeen, &latests
	npmRegistry, npmIntranetOn, npmIntranet, npmIntranetSeen, latests = fallback.URL+"/", true, office.URL, memo{}, memo{}
	t.Cleanup(func() { npmRegistry, npmIntranetOn, npmIntranet = oldReg, oldOn, oldURL; *oldSeen, *oldLatests = memo{}, memo{} })

	if r := npmRegistryFor(); r != office.URL {
		t.Fatalf("the office registry should answer: got %q", r)
	}
	if v, err := npmLatest("@scope/pkg"); err != nil || v != "2.0.0" {
		t.Fatalf("npmLatest: want the office registry's 2.0.0, got %q", v)
	}
	if v, err := npmLatest("plain"); err != nil || v != "1.5.0" {
		t.Fatalf("npmLatest: want npm's own 1.5.0 for one the office registry hasn't, got %q", v)
	}
	cmd := npmGlobalInstall("/prefix/bin/npm", "/prefix")
	if !strings.Contains(strings.Join(cmd, " "), "--registry="+office.URL) {
		t.Fatalf("npmGlobalInstall: the update should carry the office registry: %v", cmd)
	}
	if c := npmInstall("plain", "windows", true); !strings.Contains(c.Command, "--registry="+office.URL) {
		t.Fatalf("npmInstall: the command should carry the office registry: %s", c.Command)
	}

	// the office registry down: npm's own, asked directly
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	deadURL := dead.URL
	dead.Close() // the port nobody listens on any more
	oldURL2, oldSeen2 := npmIntranet, &npmIntranetSeen
	npmIntranet, npmIntranetSeen = deadURL, memo{}
	t.Cleanup(func() { npmIntranet = oldURL2; *oldSeen2 = memo{} })
	if r := npmRegistryFor(); r != "" {
		t.Fatalf("a dead office registry should fall back to npm's own: got %q", r)
	}
	if v, err := npmLatest("plain"); err != nil || v != "1.5.0" {
		t.Fatalf("npmLatest with the office registry down: want npm's own 1.5.0, got %q", v)
	}
	if cmd := npmGlobalInstall("/prefix/bin/npm", "/prefix"); strings.Contains(strings.Join(cmd, " "), "--registry=") {
		t.Fatalf("npmGlobalInstall with the office registry down: no registry flag expected: %v", cmd)
	}
	if c := npmInstall("plain", "windows", true); strings.Contains(c.Command, "--registry=") {
		t.Fatalf("npmInstall with the office registry down: no registry flag expected: %s", c.Command)
	}
}
