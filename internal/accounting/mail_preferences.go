package accounting

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/yetone/magpie/internal/edit"
)

// MailPreferences is the app's record of the user's daily billing email
// choice. The managed billing service owns the real state and does the
// sending; the app keeps the toggle locally and reports each change, and
// never reads the service's state back.
type MailPreferences struct {
	mu      sync.Mutex
	path    string
	user    string
	remote  MailRemote
	enabled bool
}

type MailRemote interface {
	Set(ctx context.Context, user string, enabled bool) error
}

func NewMailPreferences(dir, user string, remote MailRemote) (*MailPreferences, error) {
	user = strings.ToLower(strings.TrimSpace(user))
	if user == "" || user == "unknown" || strings.ContainsAny(user, "/\\\x00\r\n") {
		return nil, fmt.Errorf("mail preference user unavailable")
	}
	if remote == nil {
		return nil, fmt.Errorf("mail preference transport unavailable")
	}
	m := &MailPreferences{path: filepath.Join(dir, "mail-preference.json"), user: user, remote: remote, enabled: true}
	b, err := os.ReadFile(m.path)
	if err == nil {
		// A file written by the old revision-tracking client carries extra
		// fields; they are past states the service owns, and are ignored.
		var saved struct {
			Enabled bool `json:"enabled"`
		}
		if json.Unmarshal(b, &saved) != nil {
			return nil, fmt.Errorf("invalid mail preference state")
		}
		m.enabled = saved.Enabled
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return m, nil
}

func (m *MailPreferences) Enabled() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.enabled
}

// Set records the choice and reports it. The choice stays recorded when the
// report fails; toggling again reports it again.
func (m *MailPreferences) Set(ctx context.Context, on bool) error {
	m.mu.Lock()
	old := m.enabled
	m.enabled = on
	b, err := json.Marshal(struct {
		Enabled bool `json:"enabled"`
	}{on})
	if err == nil {
		if err = os.MkdirAll(filepath.Dir(m.path), 0700); err == nil {
			err = edit.WriteAtomic(m.path, append(b, '\n'))
		}
	}
	user, remote := m.user, m.remote
	m.mu.Unlock()
	if err != nil {
		m.mu.Lock()
		m.enabled = old
		m.mu.Unlock()
		return err
	}
	return remote.Set(ctx, user, on)
}
