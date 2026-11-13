//go:build intranet

package plugin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
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
	for _, kind := range []string{"codebuddy", "workbuddy", "trae", "aiep"} {
		dir := filepath.Join(root, kind)
		if err := os.MkdirAll(dir, 0700); err != nil {
			t.Fatal(err)
		}
		os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"@sub2agent/`+kind+`","version":"1.0.0","type":"module","main":"index.js"}`), 0600)
		if err := os.WriteFile(filepath.Join(dir, "index.js"), []byte("export default ()=>({})"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	entries := Load().Plugins
	if len(entries) != 4 {
		t.Fatalf("loaded %d bundled entries", len(entries))
	}
	var ps []Provider
	for _, e := range entries {
		ps = append(ps, Provider{ID: "sub2agent-" + e.Bundled, Spec: e.Spec})
	}
	UseCached(ps)
	if got := len(Cached()); got != 4 {
		t.Fatalf("host loaded 4 providers but picker sees %d", got)
	}
	// A moved portable bundle follows its current executable, retaining Off.
	l := shipped(List{Plugins: []Entry{{Spec: "old/path", Bundled: "workbuddy", Off: true}}})
	if len(l.Plugins) != 4 || l.Plugins[0].Spec != "@sub2agent/workbuddy" || !l.Plugins[0].Off {
		t.Fatalf("relocation lost settings: %+v", l.Plugins)
	}
}

func TestIntranetLightRuntimeAdmission(t *testing.T) {
	storeSandbox(t)
	t.Setenv("MAGPIE_BUN", "")
	was := shippedDirectory
	shippedDirectory = func() string { return t.TempDir() }
	t.Cleanup(func() { shippedDirectory = was })
	if HasBun() {
		t.Fatal("fixture unexpectedly has a runtime")
	}
	writeList(t, `{"plugins":[{"spec":"@sub2agent/codebuddy"}]}`)
	if !CanStart() {
		t.Fatal("first-run runtime download was skipped for an enabled provider")
	}
	writeList(t, `{"plugins":[{"spec":"@sub2agent/codebuddy","off":true}]}`)
	if CanStart() {
		t.Fatal("disabled providers requested a runtime")
	}
}

func TestShippedMarketVersionWinsAndFallsBackWithoutDuplicates(t *testing.T) {
	storeSandbox(t)
	root := t.TempDir()
	was := shippedDirectory
	shippedDirectory = func() string { return root }
	t.Cleanup(func() { shippedDirectory = was })
	kind, pkg := "workbuddy", "@sub2agent/workbuddy"
	baseline := filepath.Join(root, kind)
	os.MkdirAll(baseline, 0700)
	os.WriteFile(filepath.Join(baseline, "index.js"), []byte("baseline"), 0600)
	os.WriteFile(filepath.Join(baseline, "package.json"), []byte(`{"name":"@sub2agent/workbuddy","version":"1.0.0"}`), 0600)
	if Target(pkg) != baseline || Installed(pkg) != "1.0.0" {
		t.Fatal("offline baseline unavailable")
	}
	opts := map[string]any{"tenant": "retained"}
	l := shipped(List{Plugins: []Entry{{Spec: "old/path", Bundled: kind, Off: true, Options: opts}}, Prefer: map[string]string{"sub2agent-workbuddy": "old/path"}})
	if len(l.Plugins) != 1 || l.Plugins[0].Spec != pkg || !l.Plugins[0].Off || l.Plugins[0].Options["tenant"] != "retained" || l.Prefer["sub2agent-workbuddy"] != pkg {
		t.Fatalf("migration: %+v", l)
	}
	target := packageTarget(pkg)
	os.MkdirAll(target, 0700)
	files := map[string][]byte{"index.js": []byte("market"), "package.json": []byte(`{"name":"@sub2agent/workbuddy","version":"1.0.1","main":"index.js","type":"module"}`)}
	receipt := bundleReceipt{Package: pkg, Version: "1.0.1", Files: map[string]string{}}
	for name, data := range files {
		os.WriteFile(filepath.Join(target, name), data, 0600)
		sum := sha256.Sum256(data)
		receipt.Files[name] = hex.EncodeToString(sum[:])
	}
	raw, _ := json.Marshal(receipt)
	os.WriteFile(filepath.Join(target, ".internal-bundle.json"), raw, 0600)
	if Target(pkg) != target || Installed(pkg) != "1.0.1" {
		t.Fatal("verified market version did not override baseline")
	}
	if len(shipped(l).Plugins) != 1 {
		t.Fatal("market update duplicated provider")
	}
	os.WriteFile(filepath.Join(target, "index.js"), []byte("damaged"), 0600)
	if Target(pkg) != baseline {
		t.Fatal("damaged market package replaced offline baseline")
	}
}

func TestAIEPAdapterReadsPackagedDefaults(t *testing.T) {
	storeSandbox(t)
	root := t.TempDir()
	was := shippedDirectory
	shippedDirectory = func() string { return root }
	t.Cleanup(func() { shippedDirectory = was })
	dir := filepath.Join(root, "aiep")
	os.MkdirAll(dir, 0700)
	os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"@sub2agent/aiep","version":"1.0.0","magpie":{"nativeProvider":{"id":"aiep-coding-plan","name":"AIEP fixture","anthropic":"http://fixture.invalid/public"}}}`), 0600)
	a := AIEPAdapter()
	if a == nil || a.Anthropic != "http://fixture.invalid/public" || a.Name != "AIEP fixture" {
		t.Fatal("native AIEP declaration unavailable")
	}
	if !Official("@sub2agent/aiep") || Official("@sub2agent/unknown") {
		t.Fatal("automatic update scope incorrect")
	}
}
