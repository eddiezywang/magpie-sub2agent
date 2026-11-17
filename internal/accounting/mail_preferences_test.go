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
	"strings"
	"testing"
)

type fakeMailRemote struct {
	state     MailRemoteState
	fail      bool
	lastOp    string
	beforeSet func()
}

func (f *fakeMailRemote) Get(context.Context, string) (MailRemoteState, error) {
	if f.fail {
		return MailRemoteState{}, errors.New("offline")
	}
	return f.state, nil
}
func (f *fakeMailRemote) Set(_ context.Context, _ string, on bool, rev int64, op string) (MailRemoteState, error) {
	if f.fail {
		return MailRemoteState{}, errors.New("offline")
	}
	if f.beforeSet != nil {
		f.beforeSet()
		f.beforeSet = nil
	}
	if op == f.lastOp {
		return f.state, nil
	}
	if rev != f.state.Revision {
		r := f.state
		r.Conflict = true
		return r, nil
	}
	f.lastOp = op
	f.state = MailRemoteState{Exists: true, Enabled: on, Revision: rev + 1}
	return f.state, nil
}
func TestMailPreferenceDefaultAndOfflineConflict(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	remote := &fakeMailRemote{fail: true}
	m, err := NewMailPreferences(dir, "Alice", remote)
	if err != nil {
		t.Fatal(err)
	}
	s, _ := m.Status()
	if !s.Enabled || s.Known {
		t.Fatalf("default %+v", s)
	}
	if err = m.Set(false); err != nil {
		t.Fatal(err)
	}
	if m.Sync(ctx) == nil {
		t.Fatal("offline should fail")
	}
	m, err = NewMailPreferences(dir, "alice", remote)
	if err != nil {
		t.Fatal(err)
	}
	s, _ = m.Status()
	if s.Enabled || !s.Pending {
		t.Fatalf("offline choice lost %+v", s)
	}
	remote.fail = false
	remote.state = MailRemoteState{Exists: true, Enabled: true, Revision: 3}
	if err = m.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	s, _ = m.Status()
	if !s.Conflict || s.Pending || s.Enabled || remote.state.Revision != 3 {
		t.Fatalf("unknown revision overwrote server %+v %+v", s, remote.state)
	}
	if err = m.Set(false); err != nil {
		t.Fatal(err)
	}
	if err = m.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	s, ok := m.Status()
	if s.Enabled || s.Pending || s.Conflict || !ok || remote.state.Revision != 4 {
		t.Fatalf("explicit resolution %+v %+v", s, remote.state)
	}
}
func TestMailPreferenceInitialSyncAndStaleRetry(t *testing.T) {
	ctx := context.Background()
	remote := &fakeMailRemote{}
	m, err := NewMailPreferences(t.TempDir(), "bob", remote)
	if err != nil {
		t.Fatal(err)
	}
	if err = m.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	s, ok := m.Status()
	if !s.Enabled || s.Pending || !ok || remote.state.Revision != 1 {
		t.Fatalf("default not reported %+v", s)
	}
	if err = m.Set(false); err != nil {
		t.Fatal(err)
	}
	remote.state = MailRemoteState{Exists: true, Enabled: true, Revision: 2}
	if err = m.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	s, _ = m.Status()
	if !s.Conflict || s.Enabled || remote.state.Revision != 2 {
		t.Fatalf("stale update applied %+v %+v", s, remote.state)
	}
}
func TestMailPreferenceChangeDuringSend(t *testing.T) {
	ctx := context.Background()
	remote := &fakeMailRemote{}
	m, err := NewMailPreferences(t.TempDir(), "bob", remote)
	if err != nil {
		t.Fatal(err)
	}
	if err = m.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	if err = m.Set(false); err != nil {
		t.Fatal(err)
	}
	remote.beforeSet = func() {
		if err := m.Set(true); err != nil {
			t.Fatal(err)
		}
	}
	if err = m.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	s, _ := m.Status()
	if !s.Pending || !s.Enabled || s.Revision != 2 {
		t.Fatalf("newer change lost %+v", s)
	}
	if err = m.Sync(ctx); err != nil {
		t.Fatal(err)
	}
	s, ok := m.Status()
	if s.Pending || !s.Enabled || !ok || remote.state.Revision != 3 {
		t.Fatalf("newer change not sent %+v", s)
	}
}
func TestMailRemoteSignsExactUpdateAndReadsConflict(t *testing.T) {
	key := strings.Repeat("12", 32)
	seen := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/mail-preferences/alice" || r.URL.Query().Get("enabled") != "false" || r.URL.Query().Get("revision") != "3" {
			t.Errorf("unexpected request %s %s", r.Method, r.URL.String())
		}
		raw, _ := hex.DecodeString(key)
		mac := hmac.New(sha256.New, raw)
		fmt.Fprintf(mac, "sub2agent-billing-v1\n%s\n%s\n%s\n%s", r.Method, r.URL.RequestURI(), r.Header.Get("X-Sub2Agent-Timestamp"), r.Header.Get("X-Sub2Agent-Nonce"))
		if !hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(r.Header.Get("X-Sub2Agent-Signature"))) {
			t.Error("invalid signature")
		}
		seen = true
		w.WriteHeader(http.StatusConflict)
		_, _ = w.Write([]byte(`{"exists":true,"enabled":true,"revision":4,"conflict":true}`))
	}))
	defer srv.Close()
	remote := billingMailRemote{base: srv.URL + "/usage/events", key: key, client: srv.Client()}
	got, err := remote.Set(context.Background(), "alice", false, 3, "abcdefghijklmnop")
	if err != nil || !seen || !got.Conflict || got.Revision != 4 || !got.Enabled {
		t.Fatalf("result %+v %v", got, err)
	}
}
