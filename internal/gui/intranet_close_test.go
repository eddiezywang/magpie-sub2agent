//go:build intranet

package gui

import (
	"net/http/httptest"
	"testing"
)

type closeChoiceHost struct {
	webHost
	hidden *int
}

func (h closeChoiceHost) HideMain() { *h.hidden++ }
func TestInternalCloseChoiceRoutes(t *testing.T) {
	hidden, quit := 0, 0
	h := webPageHandler(t, closeChoiceHost{webHost{quit: func() { quit++ }}, &hidden}, nil)
	for _, tc := range []struct {
		path               string
		wantHide, wantQuit int
	}{{"/api/window/main-hide", 1, 0}, {"/api/window/quit?now=1", 1, 1}} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("POST", tc.path, nil))
		if r.Code != 204 || hidden != tc.wantHide || quit != tc.wantQuit {
			t.Fatalf("%s: status %d hide %d quit %d", tc.path, r.Code, hidden, quit)
		}
	}
}
