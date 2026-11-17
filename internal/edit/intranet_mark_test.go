//go:build intranet

package edit

import (
	"strings"
	"testing"
)

func TestInternalNoteReplacesLegacy(t *testing.T) {
	Mark = func(_, _, _ string) string { return "Sub2Agent gateway" }
	t.Cleanup(func() { Mark = nil })
	old := "# magpie: old gateway\nbase_url = \"http://localhost:8989\"\n"
	got := strings.Join(markTOML(splitLines(old), old), "\n")
	if !strings.Contains(got, "# sub2agent: Sub2Agent gateway") || strings.Contains(got, "# magpie:") {
		t.Fatalf("rewritten note: %q", got)
	}
}
