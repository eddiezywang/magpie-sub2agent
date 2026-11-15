//go:build intranet

package gui

import (
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

// Intranet must not discover the original application's sign-in. The upstream
// group tests deliberately depend on that discovery and are upstream-only.
func TestIntranetCodexAuthIsNotAProvider(t *testing.T) {
	codexSignedInSandbox(t)
	for _, p := range provider.Accounts() {
		if p.ID == "codex" {
			t.Fatal("intranet discovered the original Codex sign-in")
		}
	}
}
