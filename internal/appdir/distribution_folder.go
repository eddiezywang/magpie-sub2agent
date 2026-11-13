package appdir

import (
	"github.com/yetone/magpie/internal/distribution"
	"os"
	"path/filepath"
)

// Old internal installs remain readable. Move only when the new destination
// does not exist; never merge or replace current configuration. A locked old
// directory remains the active path rather than appearing as an empty install.
func distributionFolder(root string, move bool) string {
	next := filepath.Join(root, distribution.DataDir)
	if !distribution.Internal {
		return next
	}
	old := filepath.Join(root, "sub2agent-magpie")
	if _, err := os.Stat(next); !os.IsNotExist(err) {
		return next
	}
	if info, err := os.Stat(old); err != nil || !info.IsDir() {
		return next
	}
	if move {
		if err := os.Rename(old, next); err == nil {
			return next
		}
	}
	return old
}
