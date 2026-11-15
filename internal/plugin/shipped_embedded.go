//go:build intranet && embeddedproviders

package plugin

import (
	_ "embed"
	"log"
	"path/filepath"

	"github.com/yetone/magpie/internal/appdir"
)

// Generated privately by build/providerpack; never commit provider code.
//
//go:embed baseline.zip
var embeddedProviders []byte

func defaultShippedDirectory() string {
	root, err := materializeProviders(embeddedProviders, filepath.Join(appdir.Cache(), "bundled-providers"))
	if err != nil {
		log.Printf("internal provider baseline could not be prepared: %v", err)
		return ""
	}
	return root
}
