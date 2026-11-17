//go:build windows && intranet

package shortcut

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInternalWindowsIdentityAndMigration(t *testing.T) {
	if Name != "Sub2Agent" || !strings.HasSuffix(appPath, `\sub2agent.exe`) || !strings.HasSuffix(uninstallKey, `\sub2agent`) {
		t.Fatalf("Windows identity: %q %q %q", Name, appPath, uninstallKey)
	}
	dir := t.TempDir()
	exe := filepath.Join(dir, "sub2agent.exe")
	state := filepath.Join(dir, "state")
	old := filepath.Join(dir, "Magpie.lnk")
	next := filepath.Join(dir, "Sub2Agent.lnk")
	if err := os.WriteFile(exe, []byte("MZ"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(state, []byte(exe+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := write(old, exe); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacy(exe, state, next); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Fatalf("old shortcut remains: %v", err)
	}
	if got, err := readShortcutTarget(next); err != nil || !strings.EqualFold(got, exe) {
		t.Fatalf("new shortcut target %q: %v", got, err)
	}
	// An upstream shortcut pointing elsewhere is not ours, even with our state.
	other := filepath.Join(dir, "other.exe")
	if err := os.WriteFile(other, []byte("MZ"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := write(old, other); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(next); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacy(exe, state, next); err != nil {
		t.Fatal(err)
	}
	if got, err := readShortcutTarget(old); err != nil || !strings.EqualFold(got, other) {
		t.Fatalf("other shortcut changed: %q %v", got, err)
	}
	if _, err := os.Stat(next); !os.IsNotExist(err) {
		t.Fatalf("unexpected shortcut: %v", err)
	}
}
