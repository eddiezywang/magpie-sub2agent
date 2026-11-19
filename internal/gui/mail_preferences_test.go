//go:build intranet

package gui

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/accounting"
)

type mailRemoteFixture struct{ last bool }

func (f *mailRemoteFixture) Set(_ context.Context, _ string, enabled bool) error {
	f.last = enabled
	return nil
}

func TestInternalMailPreferenceAPI(t *testing.T) {
	fixture := &mailRemoteFixture{}
	store, err := accounting.NewMailPreferences(t.TempDir(), "alice", fixture)
	if err != nil {
		t.Fatal(err)
	}
	old := mailStore.Swap(store)
	t.Cleanup(func() { mailStore.Store(old) })
	h := webPageHandler(t, webHost{}, nil)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(method, path, strings.NewReader(body)))
		return r
	}
	if r := call("GET", "/api/mail-preference", ""); r.Code != 200 || !strings.Contains(r.Body.String(), `"enabled":true`) {
		t.Fatalf("default: %d %s", r.Code, r.Body)
	}
	if r := call("POST", "/api/mail-preference", `{"enabled":false}`); r.Code != 200 || !strings.Contains(r.Body.String(), `"enabled":false`) {
		t.Fatalf("disable: %d %s", r.Code, r.Body)
	}
	if fixture.last || store.Enabled() {
		t.Fatalf("the choice was not recorded and reported: fixture=%t store=%t", fixture.last, store.Enabled())
	}
	if r := call("POST", "/api/mail-preference", `{"enabled":true} {}`); r.Code != 400 {
		t.Fatalf("trailing JSON accepted: %d", r.Code)
	}
	if r := call("POST", "/api/mail-preference", `{"on":false}`); r.Code != 400 {
		t.Fatalf("unknown field accepted: %d", r.Code)
	}
	if r := call("GET", "/api/mail-preference", ""); r.Code != 200 || !strings.Contains(r.Body.String(), `"enabled":false`) {
		t.Fatalf("after disable: %d %s", r.Code, r.Body)
	}
}
