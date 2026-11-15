package agent

import (
	"path/filepath"
	"testing"

	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/provider"
)

func TestClaudeGroupPickReplacesOldTierOverrides(t *testing.T) {
	home, _ := codexHome(t, "", "")
	if err := provider.Save(provider.Provider{ID: "wb", Name: "WorkBuddy", Chat: "https://example.test/v1", Key: "fixture", Models: []string{"hy3", "cheap"}}); err != nil {
		t.Fatal(err)
	}
	if err := provider.SaveGroup(provider.Group{ID: "cheap-first", Name: "Cheap first", Members: []string{"wb/cheap"}}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, ".claude", "settings.json")
	writeFile(t, path, `{}`)
	a := claude(home)
	if err := a.Apply("model", "wb/hy3"); err != nil {
		t.Fatal(err)
	}
	for _, tier := range []string{"opus", "sonnet", "haiku"} {
		if err := a.Apply(tier, "wb/hy3"); err != nil {
			t.Fatal(err)
		}
	}
	if err := a.Pick("model", "group/cheap-first"); err != nil {
		t.Fatal(err)
	}
	check := func() {
		t.Helper()
		if got := claudeMain(path); got != "group/cheap-first" {
			t.Fatalf("main resolves to %q", got)
		}
		for _, tier := range []string{"opus", "sonnet", "haiku"} {
			got, _ := edit.GetJSON(path, "env."+tierEnv(tier))
			if got != "group/cheap-first" {
				t.Fatalf("%s still routes to %q instead of group", tier, got)
			}
		}
	}
	check()
	if err := a.Sync(); err != nil {
		t.Fatal(err)
	}
	check()
	// A tier explicitly changed afterwards stays independent through Sync.
	if err := a.Pick("haiku", "wb/hy3"); err != nil {
		t.Fatal(err)
	}
	if err := a.Sync(); err != nil {
		t.Fatal(err)
	}
	if got, _ := edit.GetJSON(path, "env."+tierEnv("haiku")); got != "wb/hy3" {
		t.Fatalf("explicit later override lost: %q", got)
	}
}
