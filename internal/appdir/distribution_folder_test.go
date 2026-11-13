//go:build intranet

package appdir

import (
	"os"
	"path/filepath"
	"testing"
)

func TestInternalDirectoryRenameKeepsConfiguration(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "sub2agent-magpie")
	next := filepath.Join(root, "sub2agent")
	if err := os.Mkdir(old, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "providers.json"), []byte("fixture-credential"), 0600); err != nil {
		t.Fatal(err)
	}
	if got := distributionFolder(root, false); got != old {
		t.Fatalf("read-only lookup lost old directory: %s", got)
	}
	if got := distributionFolder(root, true); got != next {
		t.Fatalf("directory not migrated: %s", got)
	}
	if raw, err := os.ReadFile(filepath.Join(next, "providers.json")); err != nil || string(raw) != "fixture-credential" {
		t.Fatal("configuration lost")
	}
	if err := os.Mkdir(old, 0700); err != nil {
		t.Fatal(err)
	}
	if got := distributionFolder(root, true); got != next {
		t.Fatal("existing new directory replaced")
	}
	if _, err := os.Stat(old); err != nil {
		t.Fatal("old directory merged into existing new directory")
	}
}
