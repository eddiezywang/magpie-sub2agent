//go:build intranet && embeddedproviders

package plugin

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/appdir"
)

func TestSingleFileBaselineWithoutExternalFolders(t *testing.T) {
	storeSandbox(t)
	root := defaultShippedDirectory()
	rel, err := filepath.Rel(appdir.Cache(), root)
	if err != nil || rel == "." || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		t.Fatalf("baseline outside application cache: %q %v", rel, err)
	}
	if len(Load().Plugins) != 4 {
		t.Fatal("single EXE did not expose all four built-in providers")
	}
	for _, kind := range shippedKinds {
		if !verifiedBundle(filepath.Join(root, kind), "@sub2agent/"+kind) {
			t.Fatal("invalid materialized baseline", kind)
		}
	}
	adapter := AIEPAdapter()
	if adapter == nil || adapter.ID != "aiep-coding-plan" || adapter.Anthropic != "http://172.21.11.82/public" {
		t.Fatalf("embedded AIEP defaults missing: %+v", adapter)
	}
}
