package plugin

import (
	"os"
	"path/filepath"
	"slices"

	"github.com/yetone/magpie/internal/distribution"
)

// Shipped providers are complete offline local plugins, resolved relative to
// this executable rather than a developer's checkout or another app's data.
var shippedDirectory = func() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return filepath.Join(filepath.Dir(exe), "providers")
}

func shipped(l List) List {
	if !distribution.Internal {
		return l
	}
	root := shippedDirectory()
	if root == "" {
		return l
	}
	for _, kind := range []string{"codebuddy", "workbuddy", "trae"} {
		spec := filepath.Join(root, kind)
		if stat, err := os.Stat(filepath.Join(spec, "index.js")); err != nil || stat.IsDir() {
			continue
		}
		if i := slices.IndexFunc(l.Plugins, func(e Entry) bool { return e.Bundled == kind || e.Spec == spec }); i >= 0 {
			l.Plugins[i].Spec, l.Plugins[i].Bundled = spec, kind
		} else {
			l.Plugins = append(l.Plugins, Entry{Spec: spec, Bundled: kind})
		}
	}
	return l
}

// effectiveList is the read-only list used both by host loading and by
// cached provider visibility. Never mutate the parsed file's shared slice.
func effectiveList() List {
	l := list()
	if distribution.Internal {
		l.Plugins = slices.Clone(l.Plugins)
		l = shipped(l)
	}
	return l
}
