package appdir

import (
	"github.com/yetone/magpie/internal/distribution"
	"os"
	"path/filepath"
	"sync"
)

// Once the new/default directory is resolved, keep using it for this process. Besides
// avoiding per-model filesystem probes, deleting it must not resurrect an
// older credential directory behind the user's back.
var settledFolders sync.Map

// Old internal installs remain readable. Move only when the new destination
// does not exist; never merge or replace current configuration. A locked old
// directory remains the active path rather than appearing as an empty install.
func distributionFolder(root string, move bool) string {
	if p, ok := settledFolders.Load(root); ok {
		return p.(string)
	}
	next := filepath.Join(root, distribution.DataDir)
	if !distribution.Internal {
		return next
	}
	old := filepath.Join(root, "sub2agent-magpie")
	if _, err := os.Stat(next); !os.IsNotExist(err) {
		if err == nil {
			settledFolders.Store(root, next)
		}
		return next
	}
	if info, err := os.Stat(old); err != nil || !info.IsDir() {
		if os.IsNotExist(err) {
			settledFolders.Store(root, next)
		}
		return next
	}
	if move {
		if err := os.Rename(old, next); err == nil {
			settledFolders.Store(root, next)
			return next
		}
	}
	return old
}
