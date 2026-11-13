package plugin

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

var baselineMu sync.Mutex

// Content-addressed generations never replace a different application's baseline
// or a marketplace installation. A complete generation is published by rename.
func materializeProviders(payload []byte, cache string) (string, error) {
	sum := sha256.Sum256(payload)
	root := filepath.Join(cache, hex.EncodeToString(sum[:]))
	baselineMu.Lock()
	defer baselineMu.Unlock()
	valid := func() bool {
		for _, kind := range shippedKinds {
			if !verifiedBundle(filepath.Join(root, kind), "@sub2agent/"+kind) {
				return false
			}
		}
		return true
	}
	if valid() {
		return root, nil
	}
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil || len(zr.File) != len(shippedKinds)*2 {
		return "", fmt.Errorf("invalid embedded provider archive")
	}
	if err = os.MkdirAll(cache, 0700); err != nil {
		return "", err
	}
	stage, err := os.MkdirTemp(cache, ".baseline-")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(stage)
	seen := map[string]bool{}
	receipts := map[string]bundleReceipt{}
	for _, file := range zr.File {
		parts := strings.Split(file.Name, "/")
		if len(parts) != 2 || !file.Mode().IsRegular() || seen[file.Name] || !safeBundlePath(file.Name) || file.UncompressedSize64 > 8<<20 {
			return "", fmt.Errorf("unsafe embedded provider entry")
		}
		kind, name := parts[0], parts[1]
		if shippedKind("@sub2agent/"+kind) == "" || name != "index.js" && name != "package.json" {
			return "", fmt.Errorf("unexpected embedded provider entry")
		}
		seen[file.Name] = true
		r, err := file.Open()
		if err != nil {
			return "", err
		}
		data, err := io.ReadAll(io.LimitReader(r, (8<<20)+1))
		r.Close()
		if err != nil || len(data) > 8<<20 {
			return "", fmt.Errorf("invalid embedded provider data")
		}
		entry := receipts[kind]
		if entry.Files == nil {
			entry = bundleReceipt{Package: "@sub2agent/" + kind, Files: map[string]string{}}
		}
		if name == "package.json" {
			var manifest struct{ Name, Version, Type, Main string }
			if json.Unmarshal(data, &manifest) != nil || manifest.Name != entry.Package || manifest.Version == "" || manifest.Type != "module" || manifest.Main != "index.js" {
				return "", fmt.Errorf("invalid embedded provider manifest")
			}
			entry.Version = manifest.Version
		}
		digest := sha256.Sum256(data)
		entry.Files[name] = hex.EncodeToString(digest[:])
		receipts[kind] = entry
		dir := filepath.Join(stage, kind)
		if err = os.MkdirAll(dir, 0700); err != nil {
			return "", err
		}
		if err = os.WriteFile(filepath.Join(dir, name), data, 0600); err != nil {
			return "", err
		}
	}
	for _, kind := range shippedKinds {
		entry := receipts[kind]
		if entry.Version == "" || len(entry.Files) != 2 {
			return "", fmt.Errorf("incomplete embedded provider")
		}
		raw, err := json.Marshal(entry)
		if err != nil {
			return "", err
		}
		if err = os.WriteFile(filepath.Join(stage, kind, ".internal-bundle.json"), raw, 0600); err != nil {
			return "", err
		}
	}
	if err = os.Rename(stage, root); err == nil {
		return root, nil
	}
	// Another process may have published the same complete generation.
	if valid() {
		return root, nil
	}
	if _, err = os.Stat(root); err != nil {
		return "", err
	}
	backup := stage + ".previous"
	if err = os.Rename(root, backup); err != nil {
		return "", err
	}
	if err = os.Rename(stage, root); err != nil {
		if restore := os.Rename(backup, root); restore != nil {
			return "", fmt.Errorf("baseline publish: %v; restore: %v", err, restore)
		}
		return "", err
	}
	_ = os.RemoveAll(backup)
	return root, nil
}
