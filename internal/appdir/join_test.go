package appdir

import (
	"github.com/yetone/magpie/internal/distribution"
	"os"
	"path/filepath"
	"testing"
)

// magpie's folders and the files named from them are joined once, not on
// every read of a file, and a folder changed since is seen at once.
func TestFoldersJoinedOnce(t *testing.T) {
	t.Setenv("APPIMAGE", "")
	r := root(t)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(r, "cfg"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(r, "cache"))
	t.Cleanup(func() { UseExecutable("") })
	UseExecutable("")
	// Windows' os.Getenv converts UTF-16 on every read. Measure that native
	// overhead separately; joining an unchanged path must add no allocations.
	envAllocs := testing.AllocsPerRun(20, func() { os.Getenv("XDG_CACHE_HOME") })

	for name, f := range map[string]func(){
		"Config":   func() { Config() },
		"Cache":    func() { Cache() },
		"JoinFile": func() { JoinFile(Cache(), "openai", ".json") },
	} {
		f()
		if n := testing.AllocsPerRun(20, f); n > envAllocs {
			t.Errorf("%s with the folders unchanged: %.0f allocations beyond environment reads", name, n-envAllocs)
		}
	}
	if got, want := JoinFile(Join(Cache(), "models"), "openai", ".json"), filepath.Join(r, "cache", distribution.DataDir, "models", "openai.json"); got != want {
		t.Errorf("JoinFile = %q, want %q", got, want)
	}

	t.Setenv("XDG_CACHE_HOME", filepath.Join(r, "other"))
	if got, want := Cache(), filepath.Join(r, "other", distribution.DataDir); got != want {
		t.Errorf("a cache folder changed since: %q, want %q", got, want)
	}
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv(homeVar(), filepath.Join(r, "home"))
	if got, want := Config(), filepath.Join(r, "home", ".config", distribution.DataDir); got != want {
		t.Errorf("under the home folder: %q, want %q", got, want)
	}
}
