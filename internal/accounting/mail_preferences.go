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

// MailPreference is persisted separately from telemetry, so its opt-out can
// be reported even when usage telemetry has been disabled.
type MailPreference struct {
	User      string `json:"user"`
	Enabled   bool   `json:"enabled"`
	Known     bool   `json:"known"`
	Revision  int64  `json:"revision"`
	Pending   bool   `json:"pending"`
	Conflict  bool   `json:"conflict"`
	Operation string `json:"operation,omitempty"`
}
type MailRemoteState struct {
	Exists   bool  `json:"exists"`
	Enabled  bool  `json:"enabled"`
	Revision int64 `json:"revision"`
	Conflict bool  `json:"conflict"`
}
type MailRemote interface {
	Get(context.Context, string) (MailRemoteState, error)
	Set(context.Context, string, bool, int64, string) (MailRemoteState, error)
}
type MailPreferences struct {
	mu     sync.Mutex
	path   string
	state  MailPreference
	synced bool
	remote MailRemote
}

func NewMailPreferences(dir, user string, remote MailRemote) (*MailPreferences, error) {
	user = strings.ToLower(strings.TrimSpace(user))
	if user == "" || user == "unknown" || strings.ContainsAny(user, "/\\\x00\r\n") {
		return nil, fmt.Errorf("mail preference user unavailable")
	}
	if remote == nil {
		return nil, fmt.Errorf("mail preference transport unavailable")
	}
	m := &MailPreferences{path: filepath.Join(dir, "mail-preference.json"), remote: remote, state: MailPreference{User: user, Enabled: true}}
	b, err := os.ReadFile(m.path)
	if err == nil {
		if json.Unmarshal(b, &m.state) != nil || m.state.User != user || m.state.Revision < 0 || m.state.Pending && !validID(m.state.Operation) {
			return nil, fmt.Errorf("invalid mail preference state")
		}
	} else if !os.IsNotExist(err) {
		return nil, err
	}
	return m, nil
}
func (m *MailPreferences) persist() error {
	b, err := json.Marshal(m.state)
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Dir(m.path), 0700); err != nil {
		return err
	}
	return edit.WriteAtomic(m.path, append(b, '\n'))
}
func (m *MailPreferences) Status() (MailPreference, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.state, m.synced
}
func (m *MailPreferences) Set(on bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	old, wasSynced := m.state, m.synced
	m.state.Enabled = on
	m.state.Pending = true
	m.state.Conflict = false
	m.state.Operation = NewID()
	m.synced = false
	if err := m.persist(); err != nil {
		m.state, m.synced = old, wasSynced
		return err
	}
	return nil
}

// Sync fetches an unknown server revision first. An offline change without a
// prior revision requires explicit confirmation if an account value exists.
func (m *MailPreferences) Sync(ctx context.Context) (syncErr error) {
	defer func() {
		if syncErr != nil {
			m.mu.Lock()
			m.synced = false
			m.mu.Unlock()
		}
	}()
	m.mu.Lock()
	snapshot := m.state
	m.mu.Unlock()
	if !snapshot.Known {
		remote, err := m.remote.Get(ctx, snapshot.User)
		if err != nil {
			return err
		}
		m.mu.Lock()
		if m.state != snapshot {
			m.mu.Unlock()
			return nil
		}
		old := m.state
		m.state.Known = true
		m.state.Revision = remote.Revision
		if snapshot.Pending && remote.Exists {
			m.state.Conflict = true
			m.state.Pending = false
			m.synced = false
		} else if !snapshot.Pending && remote.Exists {
			m.state.Enabled = remote.Enabled
			m.synced = true
		} else if !snapshot.Pending {
			m.state.Pending = true
			m.state.Operation = NewID()
			m.synced = false
		}
		if err := m.persist(); err != nil {
			m.state = old
			m.mu.Unlock()
			return err
		}
		snapshot = m.state
		m.mu.Unlock()
	}
	if snapshot.Known && !snapshot.Pending && !snapshot.Conflict {
		remote, err := m.remote.Get(ctx, snapshot.User)
		if err != nil {
			return err
		}
		if !remote.Exists || remote.Revision < snapshot.Revision {
			return fmt.Errorf("mail preference server state regressed")
		}
		m.mu.Lock()
		defer m.mu.Unlock()
		if m.state != snapshot {
			return nil
		}
		old := m.state
		m.state.Enabled, m.state.Revision = remote.Enabled, remote.Revision
		if err := m.persist(); err != nil {
			m.state = old
			return err
		}
		m.synced = true
		return nil
	}
	if !snapshot.Pending || snapshot.Conflict {
		return nil
	}
	result, err := m.remote.Set(ctx, snapshot.User, snapshot.Enabled, snapshot.Revision, snapshot.Operation)
	if err != nil {
		return err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	old := m.state
	if result.Conflict {
		if m.state.Operation == snapshot.Operation {
			m.state.Known = true
			m.state.Revision = result.Revision
			m.state.Pending = false
			m.state.Conflict = true
			m.synced = false
		}
	} else if result.Exists && result.Revision == snapshot.Revision+1 && result.Enabled == snapshot.Enabled {
		if m.state.Revision == snapshot.Revision {
			m.state.Known = true
			m.state.Revision = result.Revision
		}
		if m.state.Operation == snapshot.Operation {
			m.state.Pending = false
			m.state.Conflict = false
			m.synced = true
		}
	} else {
		return fmt.Errorf("invalid mail preference response")
	}
	if err := m.persist(); err != nil {
		m.state = old
		return err
	}
	return nil
}
