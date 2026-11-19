package gui

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"github.com/yetone/magpie/internal/accounting"
	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/distribution"
)

type mailPreferenceWorker struct {
	preferences *accounting.MailPreferences
	wake        chan struct{}
	cancel      context.CancelFunc
}

var mailWorker atomic.Pointer[mailPreferenceWorker]

func startMailPreference() {
	if !distribution.Internal {
		return
	}
	user := os.Getenv("USERNAME")
	if user == "" {
		user = os.Getenv("USER")
	}
	preferences, err := accounting.NewDefaultMailPreferences(appdir.Config(), user)
	if err != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	w := &mailPreferenceWorker{preferences: preferences, wake: make(chan struct{}, 1), cancel: cancel}
	if !mailWorker.CompareAndSwap(nil, w) {
		cancel()
		return
	}
	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		defer mailWorker.CompareAndSwap(w, nil)
		for {
			_ = w.preferences.Sync(ctx)
			select {
			case <-ctx.Done():
				return
			case <-w.wake:
			case <-ticker.C:
			}
		}
	}()
}
func stopMailPreference() {
	if w := mailWorker.Swap(nil); w != nil {
		w.cancel()
	}
}
func (w *mailPreferenceWorker) signal() {
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

type mailPreferenceView struct {
	Enabled  bool `json:"enabled"`
	Synced   bool `json:"synced"`
	Pending  bool `json:"pending"`
	Conflict bool `json:"conflict"`
}

func mailView(w *mailPreferenceWorker) mailPreferenceView {
	s, synced := w.preferences.Status()
	return mailPreferenceView{Enabled: s.Enabled, Synced: synced, Pending: s.Pending, Conflict: s.Conflict}
}
func handleMailPreference(w http.ResponseWriter, r *http.Request) {
	if !distribution.Internal {
		http.NotFound(w, r)
		return
	}
	worker := mailWorker.Load()
	if worker == nil {
		http.Error(w, "mail preference unavailable", http.StatusServiceUnavailable)
		return
	}
	if r.Method == http.MethodPost {
		var in struct {
			Enabled *bool `json:"enabled"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&in); err != nil || in.Enabled == nil {
			http.Error(w, "invalid mail preference", http.StatusBadRequest)
			return
		}
		if dec.Decode(&struct{}{}) != io.EOF {
			http.Error(w, "invalid mail preference", http.StatusBadRequest)
			return
		}
		if err := worker.preferences.Set(*in.Enabled); err != nil {
			http.Error(w, "unable to save mail preference", http.StatusInternalServerError)
			return
		}
		worker.signal()
	}
	writeJSON(w, mailView(worker))
}
