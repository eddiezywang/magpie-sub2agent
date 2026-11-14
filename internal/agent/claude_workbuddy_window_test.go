package agent

import (
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/provider"
	"path/filepath"
	"testing"
)

func TestClaudeWorkBuddyWorkingWindow(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	t.Setenv("USERPROFILE", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(home, ".cache"))
	const pid = "sub2agent-workbuddy"
	const model = "glm-5.3-flash-maas-fixture"
	if err := provider.Save(provider.Provider{ID: pid, Chat: "https://example.test/v1", Key: "fixture", Models: []string{model, "hy4free"}}); err != nil {
		t.Fatal(err)
	}
	if err := catalog.SaveLive(pid, "https://example.test/v1", []catalog.Model{{ID: model, Context: 256000}, {ID: "hy4free", Context: 960000}}); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, ".claude", "settings.json")
	writeFile(t, path, `{}`)
	a := claude(home)
	if err := a.Field("model").Set(pid + "/" + model); err != nil {
		t.Fatal(err)
	}
	window, _ := edit.GetJSON(path, "env."+claudeContextEnv)
	if window != "256000" {
		t.Fatalf("Agent context=%s, want working window", window)
	}
	compact, _ := edit.GetJSON(path, "autoCompactWindow")
	perModel, _ := edit.GetJSON(path, budgetPath(pid+"/"+model))
	envCompact, _ := edit.GetJSON(path, "env."+claudeCompactEnv)
	if compact != "224000" && perModel != "224000" && envCompact != "224000" {
		t.Fatalf("compact top=%s model=%s", compact, perModel)
	}
	if err := edit.SetJSON(path, edit.KV{Path: budgetPath(pid + "/" + model), Value: "180000"}); err != nil {
		t.Fatal(err)
	}
	// A model-specific value changed externally must remain the user's.
	if err := a.Sync(); err != nil {
		t.Fatal(err)
	}
	own, _ := edit.GetJSON(path, budgetPath(pid+"/"+model))
	if own != "180000" {
		t.Fatalf("user compact overwritten: %s", own)
	}
}
