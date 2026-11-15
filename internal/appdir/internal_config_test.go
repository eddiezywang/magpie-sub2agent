package appdir

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/yetone/magpie/internal/distribution"
)

func TestSharedConfigMigration(t *testing.T) {
	for _, name := range []string{"portable", "installed", "renamed"} {
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			source, target := filepath.Join(root, name), filepath.Join(root, ".sub2agent")
			fixture := func(file, contents string) {
				t.Helper()
				path := filepath.Join(source, file)
				if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			fixture("settings.json", `{"lang":"zh"}`)
			fixture("plugin-auth.json", `{"fixture":"credential"}`)
			fixture("routing/groups.json", `{"fixture":"group"}`)
			fixture("cache/temporary", "cache")
			if err := os.MkdirAll(filepath.Join(target, "state"), 0o700); err != nil {
				t.Fatal(err)
			}
			legacy := filepath.Join(target, "state", "legacy.yaml")
			if err := os.WriteFile(legacy, []byte("legacy: retained"), 0o600); err != nil {
				t.Fatal(err)
			}
			got, err := migrateInternalConfig(target, []string{source})
			if err != nil || got != target {
				t.Fatalf("migration: %s %v", got, err)
			}
			for _, file := range []string{"settings.json", "plugin-auth.json", "routing/groups.json"} {
				old, err := os.ReadFile(filepath.Join(source, file))
				if err != nil {
					t.Fatal(err)
				}
				current, err := os.ReadFile(filepath.Join(target, file))
				if err != nil || string(current) != string(old) {
					t.Fatalf("lost %s: %v", file, err)
				}
			}
			if _, err := os.Stat(filepath.Join(target, "cache")); !os.IsNotExist(err) {
				t.Fatal("copied disposable cache")
			}
			if b, err := os.ReadFile(legacy); err != nil || string(b) != "legacy: retained" {
				t.Fatal("changed legacy Node state")
			}
			fixture("settings.json", `{"lang":"en"}`)
			if _, err := migrateInternalConfig(target, []string{source}); err != nil {
				t.Fatal(err)
			}
			if b, _ := os.ReadFile(filepath.Join(target, "settings.json")); string(b) != `{"lang":"zh"}` {
				t.Fatal("existing configuration overwritten")
			}
		})
	}
}

func TestSharedConfigMigrationCollisionKeepsOldDirectory(t *testing.T) {
	root := t.TempDir()
	source, target := filepath.Join(root, "old"), filepath.Join(root, ".sub2agent")
	for _, dir := range []string{source, target} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(source, "settings.json"), []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{source, target} {
		if err := os.WriteFile(filepath.Join(dir, "same"), []byte(dir), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	got, err := migrateInternalConfig(target, []string{source})
	if got != source || err == nil {
		t.Fatalf("collision: %s %v", got, err)
	}
	if _, err := os.Stat(filepath.Join(target, "settings.json")); !os.IsNotExist(err) {
		t.Fatal("published a partial configuration")
	}
}

func TestInternalConfigSharesHomeAndMigratesLegacy(t *testing.T) {
	if !distribution.Internal {
		t.Skip("internal distribution only")
	}
	home := t.TempDir()
	t.Setenv(homeVar(), home)
	t.Setenv("XDG_CONFIG_HOME", "")
	old := filepath.Join(home, ".config", "sub2agent")
	if err := os.MkdirAll(old, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "plugin-auth.json"), []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, ".sub2agent")
	for _, name := range []string{"version-one", "version-two"} {
		exe := filepath.Join(home, name, "sub2agent.exe")
		if err := os.MkdirAll(filepath.Dir(exe), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(filepath.Dir(exe), ".portable"), nil, 0o600); err != nil {
			t.Fatal(err)
		}
		UseExecutable(exe)
		if got := Config(); got != want || Portable() != "" {
			t.Fatalf("%s configuration: %s", name, got)
		}
	}
	t.Cleanup(func() { UseExecutable("") })
	if b, err := os.ReadFile(filepath.Join(want, "plugin-auth.json")); err != nil || string(b) != "fixture" {
		t.Fatal("credentials not migrated")
	}
	if _, err := os.Stat(filepath.Join(old, "plugin-auth.json")); err != nil {
		t.Fatal("old credentials removed")
	}
}

func TestInterruptedConfigMigrationKeepsSource(t *testing.T) {
	root := t.TempDir()
	source, target := filepath.Join(root, "old"), filepath.Join(root, ".sub2agent")
	if err := os.MkdirAll(source, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "settings.json"), []byte("complete"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(target, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, "settings.json"), []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(target, ".config-migration-source"), []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := migrateInternalConfig(target, nil); got != source || err == nil {
		t.Fatalf("interrupted migration: %s %v", got, err)
	}
}
