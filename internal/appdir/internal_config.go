package appdir

import (
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"sync"
)

var internalConfigs sync.Map
var internalConfigMu sync.Mutex

func internalConfig() string {
	// An explicit XDG location remains an intentional override.
	var target string
	if x := os.Getenv("XDG_CONFIG_HOME"); rooted(x) {
		target = Join(x, "sub2agent")
	} else {
		target = Join(mustHome(), ".sub2agent")
	}
	if p, ok := internalConfigs.Load(target); ok {
		return p.(string)
	}
	internalConfigMu.Lock()
	defer internalConfigMu.Unlock()
	if p, ok := internalConfigs.Load(target); ok {
		return p.(string)
	}
	var sources []string
	home := mustHome()
	if x := os.Getenv("XDG_CONFIG_HOME"); rooted(x) {
		sources = append(sources, filepath.Join(x, "sub2agent-magpie"))
	} else {
		if exe, err := os.Executable(); err == nil {
			sources = append(sources, filepath.Join(Beside(exe), DataName))
		}
		sources = append(sources, filepath.Join(home, ".config", "sub2agent"), filepath.Join(home, ".config", "sub2agent-magpie"))
	}
	active, err := migrateInternalConfig(target, sources)
	if err != nil {
		log.Printf("appdir: could not copy old Sub2Agent configuration; continuing with %s: %v", active, err)
	}
	internalConfigs.Store(target, active)
	return active
}

// Existing Go configuration wins. Legacy Node data/state directories alone
// do not count as a Go configuration and are never replaced or converted here.
func hasInternalConfig(dir string) bool {
	for _, name := range []string{"settings.json", "providers.json", "plugin-auth.json", "agents.json", "groups.json"} {
		if st, err := os.Stat(filepath.Join(dir, name)); err == nil && st.Mode().IsRegular() {
			return true
		}
	}
	return false
}

func migrateInternalConfig(target string, sources []string) (string, error) {
	if b, err := os.ReadFile(filepath.Join(target, ".config-migration-source")); err == nil {
		if !filepath.IsAbs(string(b)) || !hasInternalConfig(string(b)) {
			// Stop rather than read a partially published catalog or create
			// an empty configuration over the last usable one.
			panic("Sub2Agent configuration migration is incomplete and its original directory is unavailable")
		}
		return string(b), fmt.Errorf("an earlier configuration copy did not finish")
	}
	if hasInternalConfig(target) {
		return target, nil
	}
	for _, source := range sources {
		if filepath.Clean(source) == filepath.Clean(target) || !hasInternalConfig(source) {
			continue
		}
		if err := copyInternalConfig(source, target); err != nil {
			return source, err
		}
		return target, nil
	}
	return target, nil
}

// Stage the complete copy before publishing. Keep the old directory usable
// by older executables; never overwrite a file already in the destination.
func copyInternalConfig(source, target string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(filepath.Dir(target), ".sub2agent-migrate-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	err = filepath.WalkDir(source, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case "cache", "logs", "webview2", "node_modules", ".git", "request-archive":
				return filepath.SkipDir
			}
			return os.MkdirAll(filepath.Join(stage, rel), 0o700)
		}
		if !d.Type().IsRegular() {
			return fmt.Errorf("cannot migrate non-regular configuration file %s", rel)
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(filepath.Join(stage, rel), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, in)
		closeErr := out.Close()
		if err != nil {
			return err
		}
		return closeErr
	})
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(stage)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if _, err := os.Lstat(filepath.Join(target, entry.Name())); !os.IsNotExist(err) {
			return fmt.Errorf("destination already contains %s; keeping old configuration", entry.Name())
		}
	}
	if _, err := os.Stat(target); os.IsNotExist(err) {
		return os.Rename(stage, target)
	}
	// The original Node runtime may already own data/, logs/ and state/.
	// All collisions were checked before adding the Go configuration.
	note := filepath.Join(target, ".config-migration-source")
	if err := os.WriteFile(note, []byte(source), 0o600); err != nil {
		return err
	}
	for _, entry := range entries {
		if err := os.Rename(filepath.Join(stage, entry.Name()), filepath.Join(target, entry.Name())); err != nil {
			return err
		}
	}
	return os.Remove(note)
}
