//go:build intranet

package gui

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/accounting"
)

type mailRemoteFixture struct{}

func (mailRemoteFixture) Get(context.Context, string) (accounting.MailRemoteState, error) {
	return accounting.MailRemoteState{}, nil
}
func (mailRemoteFixture) Set(context.Context, string, bool, int64, string) (accounting.MailRemoteState, error) {
	return accounting.MailRemoteState{}, nil
}
func TestInternalMailPreferenceAPI(t *testing.T) {
	m, err := accounting.NewMailPreferences(t.TempDir(), "alice", mailRemoteFixture{})
	if err != nil {
		t.Fatal(err)
	}
	worker := &mailPreferenceWorker{preferences: m, wake: make(chan struct{}, 1), cancel: func() {}}
	old := mailWorker.Swap(worker)
	t.Cleanup(func() { mailWorker.Store(old) })
	h := webPageHandler(t, webHost{}, nil)
	call := func(method, path, body string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(method, path, strings.NewReader(body)))
		return r
	}
	if r := call("GET", "/api/mail-preference", ""); r.Code != 200 || !strings.Contains(r.Body.String(), `"enabled":true`) {
		t.Fatalf("default: %d %s", r.Code, r.Body)
	}
	if r := call("POST", "/api/mail-preference", `{"enabled":false}`); r.Code != 200 || !strings.Contains(r.Body.String(), `"pending":true`) {
		t.Fatalf("disable: %d %s", r.Code, r.Body)
	}
	if r := call("POST", "/api/mail-preference", `{"enabled":true} {}`); r.Code != 400 {
		t.Fatalf("trailing JSON accepted: %d", r.Code)
	}
	s, _ := m.Status()
	if s.Enabled || !s.Pending {
		t.Fatalf("failed request modified preference: %+v", s)
	}
}
