package gui

import (
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/distribution"
)

func TestRetroFrameBootFollowsWindowAndBuild(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(h, "cache"))
	t.Setenv("SUB2AGENT_RETRO_FRAME", "1")
	for _, tc := range []struct {
		name string
		host Windows
		want bool
	}{
		{"desktop", nil, runtime.GOOS == "windows" && distribution.Internal},
		{"browser", webHost{}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			Handler(tc.host, nil).ServeHTTP(rec, httptest.NewRequest("GET", "/boot.js", nil))
			if got := strings.Contains(rec.Body.String(), `"retroFrame":true`); got != tc.want {
				t.Errorf("retroFrame in %s boot = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}
