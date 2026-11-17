//go:build intranet

package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/edit"
)

func TestInternalBackupAndNotes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.json")
	original := []byte("{ \"value\": 1 }\n")
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	b := beforeMagpie{files: []string{path}}
	b.take()
	if got, err := os.ReadFile(path + ".before-sub2agent"); err != nil || string(got) != string(original) {
		t.Fatalf("backup: %q %v", got, err)
	}
	if _, err := os.Stat(path + ".before-magpie"); !os.IsNotExist(err) {
		t.Fatalf("upstream backup touched: %v", err)
	}
	if err := os.WriteFile(path, []byte("{\"value\":1}"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := b.restore(); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(path); string(got) != string(original) {
		t.Fatalf("restore: %q", got)
	}
	note := lineNote("", "model_provider", magpieID)
	if strings.Contains(strings.ToLower(note), "magpie") || !strings.Contains(note, "sub2agent uninstall") {
		t.Fatalf("note: %q", note)
	}
	if !edit.IsNote("# magpie: old") || !edit.IsNote("# sub2agent: new") {
		t.Fatal("old and new notes must be recognized")
	}
}
