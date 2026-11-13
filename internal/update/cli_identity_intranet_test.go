//go:build intranet

package update

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInternalCLILeavesOriginalCommandAlone(t *testing.T) {
	dir := t.TempDir()
	old := filepath.Join(dir, "magpie.com")
	if err := os.WriteFile(old, []byte("original launcher"), 0600); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(dir, "sub2agent-download.exe")
	cmd, err := writeCom([]byte("fixture console"), exe)
	if err != nil || filepath.Base(cmd) != "sub2agent.com" || !comRuns(cmd, exe) {
		t.Fatalf("console: %q %v", cmd, err)
	}
	shim, err := writeShim(exe)
	if err != nil || filepath.Base(shim) != "sub2agent.cmd" || !shimRuns(shim, exe) {
		t.Fatalf("shim: %q %v", shim, err)
	}
	if b, _ := os.ReadFile(old); string(b) != "original launcher" {
		t.Fatal("original command overwritten")
	}
	for _, name := range cliNames() {
		if strings.Contains(name, "magpie") {
			t.Fatal("original command considered internal CLI")
		}
	}
	if needsShim(filepath.Join(dir, "sub2agent.exe")) {
		t.Fatal("branded executable needs a shim")
	}
}
