//go:build intranet

package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func providerArchive(t *testing.T, version string) []byte {
	t.Helper()
	files := map[string]string{}
	for _, kind := range shippedKinds {
		files[kind+"/index.js"] = "export default async()=>({}); //" + version
		files[kind+"/package.json"] = `{"name":"@sub2agent/` + kind + `","version":"` + version + `","type":"module","main":"index.js"}`
	}
	return internalTestZIP(t, files)
}

func TestEmbeddedProvidersMaterializeAndKeepMarketplace(t *testing.T) {
	storeSandbox(t)
	cache := t.TempDir()
	payload := providerArchive(t, "1.0.0")
	root, err := materializeProviders(payload, cache)
	if err != nil {
		t.Fatal(err)
	}
	was := shippedDirectory
	shippedDirectory = func() string { return root }
	t.Cleanup(func() { shippedDirectory = was })
	entries := Load().Plugins
	if len(entries) != 4 {
		t.Fatalf("expected four embedded providers, got %d", len(entries))
	}
	legacy := filepath.Join(legacyShippedDirectory(), "workbuddy")
	raw, err := json.Marshal(List{Plugins: []Entry{{Spec: legacy, Off: true, Options: map[string]any{"tenant": "retained"}}}})
	if err != nil {
		t.Fatal(err)
	}
	writeList(t, string(raw))
	list := Load()
	if len(list.Plugins) != 4 || !list.Plugins[0].Off || list.Plugins[0].Options["tenant"] != "retained" || list.Plugins[0].Spec != "@sub2agent/workbuddy" {
		t.Fatalf("legacy preferences lost: %+v", list)
	}
	if canonicalShippedSpec(legacy) != "@sub2agent/workbuddy" {
		t.Fatal("legacy cached provider not projected")
	}
	// A damaged extracted baseline is repaired from the executable.
	entry := filepath.Join(root, "codebuddy", "index.js")
	if err = os.WriteFile(entry, []byte("damaged"), 0600); err != nil {
		t.Fatal(err)
	}
	if repaired, err := materializeProviders(payload, cache); err != nil || repaired != root || !verifiedBundle(filepath.Join(root, "codebuddy"), "@sub2agent/codebuddy") {
		t.Fatal("baseline not repaired", err)
	}
	// A marketplace package resides separately and stays untouched on upgrade.
	market := packageTarget("@sub2agent/workbuddy")
	if err = os.MkdirAll(market, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(market, "sentinel"), []byte("installed version"), 0600); err != nil {
		t.Fatal(err)
	}
	next, err := materializeProviders(providerArchive(t, "1.0.1"), cache)
	if err != nil || next == root {
		t.Fatal("new baseline did not receive an independent generation", err)
	}
	data, err := os.ReadFile(filepath.Join(market, "sentinel"))
	if err != nil || string(data) != "installed version" {
		t.Fatal("embedded upgrade changed marketplace data")
	}
}

func TestEmbeddedProvidersConcurrentAndRejectIncomplete(t *testing.T) {
	cache := t.TempDir()
	payload := providerArchive(t, "1.0.0")
	var group sync.WaitGroup
	for range 8 {
		group.Go(func() {
			if _, err := materializeProviders(payload, cache); err != nil {
				t.Error(err)
			}
		})
	}
	group.Wait()
	if _, err := materializeProviders(internalTestZIP(t, map[string]string{"../outside.js": "bad"}), cache); err == nil {
		t.Fatal("accepted incomplete unsafe archive")
	}
}
