//go:build intranet

package plugin

import (
	"os"
	"path/filepath"
	"testing"
)

func TestIntranetShippedProvidersRemainVisibleWithoutPluginsFile(t *testing.T) {
	storeSandbox(t)
	root := t.TempDir()
	was := shippedDirectory
	shippedDirectory = func() string { return root }
	t.Cleanup(func() { shippedDirectory = was; UseCached(nil) })
	for _, kind := range []string{"codebuddy", "workbuddy", "trae"} {
		dir := filepath.Join(root, kind)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte("export default ()=>({})"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	entries := Load().Plugins
	if len(entries) != 3 {
		t.Fatalf("loaded %d bundled entries", len(entries))
	}
	var ps []Provider
	for _, e := range entries {
		ps = append(ps, Provider{ID: "sub2agent-" + e.Bundled, Spec: e.Spec})
	}
	UseCached(ps)
	if got := len(Cached()); got != 3 {
		t.Fatalf("host loaded 3 providers but picker sees %d", got)
	}
	// A moved portable bundle follows its current executable, retaining Off.
	l := shipped(List{Plugins: []Entry{{Spec: "old/path", Bundled: "workbuddy", Off: true}}})
	if len(l.Plugins) != 3 || l.Plugins[0].Spec != filepath.Join(root, "workbuddy") || !l.Plugins[0].Off {
		t.Fatalf("relocation lost settings: %+v", l.Plugins)
	}
}
