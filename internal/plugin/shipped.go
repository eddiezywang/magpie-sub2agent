package plugin

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/update"
)

// Single-file releases materialize an embedded immutable baseline in app cache;
// directory releases retain the executable-relative baseline for compatibility.
var shippedDirectory = defaultShippedDirectory

func legacyShippedDirectory() string {
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
	l.Plugins = slices.Clone(l.Plugins)
	l.Prefer = cloneStringMap(l.Prefer)
	root := shippedDirectory()
	if root == "" {
		return l
	}
	for _, kind := range shippedKinds {
		pkg := "@sub2agent/" + kind
		legacy := filepath.Join(root, kind)
		if _, err := os.Stat(filepath.Join(legacy, "package.json")); err != nil {
			continue
		}
		if i := slices.IndexFunc(l.Plugins, func(e Entry) bool {
			return e.Bundled == kind || Name(e.Spec) == pkg || e.Spec == legacy || e.Spec == filepath.Join(legacyShippedDirectory(), kind)
		}); i >= 0 {
			old := l.Plugins[i].Spec
			l.Plugins[i].Spec, l.Plugins[i].Bundled = pkg, kind
			for id, chosen := range l.Prefer {
				if chosen == old {
					l.Prefer[id] = pkg
				}
			}
		} else {
			l.Plugins = append(l.Plugins, Entry{Spec: pkg, Bundled: kind})
		}
	}

	seen := map[string]bool{}
	out := l.Plugins[:0]
	for _, e := range l.Plugins {
		if shippedKind(Name(e.Spec)) != "" {
			if seen[Name(e.Spec)] {
				continue
			}
			seen[Name(e.Spec)] = true
		}
		out = append(out, e)
	}
	l.Plugins = out
	return l
}

// effectiveList is the read-only list used both by host loading and by
// cached provider visibility. Never mutate the parsed file's shared slice.
func effectiveList() List {
	l := list()
	if distribution.Internal {
		l.Plugins = slices.Clone(l.Plugins)
		l.Prefer = cloneStringMap(l.Prefer)
		l = shipped(l)
		for i := range l.Plugins {
			switch Name(l.Plugins[i].Spec) {
			case "@sub2agent/codebuddy", "@sub2agent/trae":
				l.Plugins[i].Off = true
			}
		}
	}
	return l
}

var shippedKinds = []string{"codebuddy", "workbuddy", "trae", "aiep"}

func cloneStringMap(in map[string]string) map[string]string {
	if in == nil {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func shippedKind(pkg string) string {
	if !distribution.Internal {
		return ""
	}
	kind := strings.TrimPrefix(pkg, "@sub2agent/")
	if kind == pkg || !slices.Contains(shippedKinds, kind) {
		return ""
	}
	return kind
}

// Marketplace installations win over the portable baseline only after the
// complete file manifest has been verified. Never write into the baseline.
func shippedTarget(pkg string) string {
	kind := shippedKind(pkg)
	if kind == "" {
		return ""
	}
	target := packageTarget(pkg)
	baseline := filepath.Join(shippedDirectory(), kind)
	if verifiedBundle(target, pkg) {
		version := func(dir string) string {
			var manifest struct{ Name, Version string }
			raw, err := os.ReadFile(filepath.Join(dir, "package.json"))
			if err != nil || json.Unmarshal(raw, &manifest) != nil || manifest.Name != pkg {
				return ""
			}
			return manifest.Version
		}
		if !update.Newer(version(baseline), version(target)) {
			return target
		}
	}
	return baseline
}

type bundleReceipt struct {
	Package string            `json:"package"`
	Version string            `json:"version"`
	Files   map[string]string `json:"files"`
}

func verifiedBundle(dir, pkg string) bool {
	raw, err := os.ReadFile(filepath.Join(dir, ".internal-bundle.json"))
	if err != nil {
		return false
	}
	var receipt bundleReceipt
	if json.Unmarshal(raw, &receipt) != nil || receipt.Package != pkg || receipt.Version == "" || len(receipt.Files) == 0 {
		return false
	}
	for name := range receipt.Files {
		if !safeBundlePath(name) {
			return false
		}
		fi, err := os.Lstat(filepath.Join(dir, filepath.FromSlash(name)))
		if err != nil || !fi.Mode().IsRegular() {
			return false
		}
	}
	// Directory entries are few; sort their stamps so map iteration cannot force
	// rehashing megabytes of private provider code on every Target lookup.
	names := make([]string, 0, len(receipt.Files))
	for name := range receipt.Files {
		names = append(names, name)
	}
	slices.Sort(names)
	stamp := string(raw)
	for _, name := range names {
		fi, _ := os.Lstat(filepath.Join(dir, filepath.FromSlash(name)))
		if fi == nil {
			return false
		}
		stamp += fmt.Sprintf("|%s:%d:%d", name, fi.Size(), fi.ModTime().UnixNano())
	}
	verifiedMu.Lock()
	cached, ok := verifiedCache[dir]
	verifiedMu.Unlock()
	if ok && cached.stamp == stamp {
		return cached.valid
	}
	valid := true
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name)))
		if err != nil {
			valid = false
			break
		}
		sum := sha256.Sum256(data)
		if hex.EncodeToString(sum[:]) != receipt.Files[name] {
			valid = false
			break
		}
	}
	if !valid {
		return false
	}

	var manifest struct{ Name, Version string }
	data, err := os.ReadFile(filepath.Join(dir, "package.json"))
	valid = err == nil && json.Unmarshal(data, &manifest) == nil && manifest.Name == pkg && manifest.Version == receipt.Version
	verifiedMu.Lock()
	verifiedCache[dir] = verifiedResult{stamp, valid}
	verifiedMu.Unlock()
	return valid
}

var verifiedMu sync.Mutex
var verifiedCache = map[string]verifiedResult{}

type verifiedResult struct {
	stamp string
	valid bool
}

func canonicalShippedSpec(spec string) string {
	if !distribution.Internal {
		return spec
	}
	for _, e := range list().Plugins {
		if e.Spec == spec && slices.Contains(shippedKinds, e.Bundled) {
			return "@sub2agent/" + e.Bundled
		}
	}
	for _, kind := range shippedKinds {
		if spec == filepath.Join(shippedDirectory(), kind) || spec == filepath.Join(legacyShippedDirectory(), kind) {
			return "@sub2agent/" + kind
		}
	}
	return spec
}
