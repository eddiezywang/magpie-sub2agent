//go:build intranet && embeddedproviders

package plugin

import (
	_ "embed"
	"log"
	"path/filepath"
	"sync"
	"sync/atomic"

	"github.com/yetone/magpie/internal/appdir"
)

// Generated privately by build/providerpack; never commit provider code.
//
//go:embed baseline.zip
var embeddedProviders []byte

var embeddedDirectory atomic.Pointer[string]
var embeddedDirectoryMu sync.Mutex

func defaultShippedDirectory() string {
	if root := embeddedDirectory.Load(); root != nil {
		return *root
	}
	embeddedDirectoryMu.Lock()
	defer embeddedDirectoryMu.Unlock()
	if root := embeddedDirectory.Load(); root != nil {
		return *root
	}
	root, err := materializeProviders(embeddedProviders, filepath.Join(appdir.Cache(), "bundled-providers"))
	if err != nil {
		log.Printf("internal provider baseline could not be prepared: %v", err)
		return ""
	}
	embeddedDirectory.Store(&root)
	return root
}
