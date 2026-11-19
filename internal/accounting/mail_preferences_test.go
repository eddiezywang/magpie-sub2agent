package accounting

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type fakeMailRemote struct {
	err   error
	users map[string]bool
}

func (f *fakeMailRemote) Set(_ context.Context, user string, enabled bool) error {
	if f.err != nil {
		return f.err
	}
	if f.users == nil {
		f.users = map[string]bool{}
	}
	f.users[user] = enabled
	return nil
}

func TestMailPreferenceRemembersTheChoiceLocally(t *testing.T) {
	dir := t.TempDir()
	m, err := NewMailPreferences(dir, "Alice", &fakeMailRemote{})
	if err != nil {
		t.Fatal(err)
	}
	if !m.Enabled() {
		t.Fatal("default is on")
	}
	if err = m.Set(context.Background(), false); err != nil {
		t.Fatal(err)
	}
	if m.Enabled() {
		t.Fatal("choice not kept")
	}
	reloaded, err := NewMailPreferences(dir, "alice", &fakeMailRemote{})
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.Enabled() {
		t.Fatal("choice lost on reload")
	}
}

func TestMailPreferenceKeepsTheChoiceWhenTheReportFails(t *testing.T) {
	m, err := NewMailPreferences(t.TempDir(), "alice", &fakeMailRemote{err: errors.New("offline")})
	if err != nil {
		t.Fatal(err)
	}
	if err = m.Set(context.Background(), false); err == nil {
		t.Fatal("a failed report was hidden")
	}
	if m.Enabled() {
		t.Fatal("a failed report undid the choice")
	}
}

func TestMailPreferenceRejectsAnUnusableUser(t *testing.T) {
	for _, user := range []string{"", "unknown", "a/b", `a\b`, "a\nb"} {
		if _, err := NewMailPreferences(t.TempDir(), user, &fakeMailRemote{}); err == nil {
			t.Errorf("user %q accepted", user)
		}
	}
}

func TestMailPreferenceReadsTheOldClientFile(t *testing.T) {
	dir := t.TempDir()
	old := `{"user":"alice","enabled":false,"known":true,"revision":4,"pending":false,"conflict":false}`
	if err := os.WriteFile(filepath.Join(dir, "mail-preference.json"), []byte(old), 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := NewMailPreferences(dir, "alice", &fakeMailRemote{})
	if err != nil {
		t.Fatal(err)
	}
	if m.Enabled() {
		t.Fatal("the old file's choice was not read")
	}
}

func TestMailRemoteSignsTheReport(t *testing.T) {
	key := strings.Repeat("12", 32)
	seen, status := false, http.StatusOK
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/mail-preferences/alice" || r.URL.Query().Get("enabled") != "false" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
		raw, _ := hex.DecodeString(key)
		mac := hmac.New(sha256.New, raw)
		fmt.Fprintf(mac, "sub2agent-billing-v1\n%s\n%s\n%s\n%s", r.Method, r.URL.RequestURI(), r.Header.Get("X-Sub2Agent-Timestamp"), r.Header.Get("X-Sub2Agent-Nonce"))
		if !hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(r.Header.Get("X-Sub2Agent-Signature"))) {
			t.Error("invalid signature")
		}
		seen = true
		w.WriteHeader(status)
	}))
	defer srv.Close()
	remote := billingMailRemote{base: srv.URL + "/usage/events", key: key, client: srv.Client()}
	if err := remote.Set(context.Background(), "alice", false); err != nil || !seen {
		t.Fatalf("report failed: seen=%t err=%v", seen, err)
	}
	status = http.StatusServiceUnavailable
	if err := remote.Set(context.Background(), "alice", false); err == nil {
		t.Fatal("a non-200 reply was accepted")
	}
}
