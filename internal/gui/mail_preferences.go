package gui

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sync/atomic"

	"github.com/yetone/magpie/internal/accounting"
	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/distribution"
)

// The daily billing email is sent by the managed service, which owns the
// real state. This app only records the user's choice and reports it; the
// page never learns anything back from the service.
var mailStore atomic.Pointer[accounting.MailPreferences]

func startMailPreference() {
	if !distribution.Internal {
		return
	}
	user := os.Getenv("USERNAME")
	if user == "" {
		user = os.Getenv("USER")
	}
	store, err := accounting.NewDefaultMailPreferences(appdir.Config(), user)
	if err != nil {
		return
	}
	mailStore.Store(store)
}

func mailView(m *accounting.MailPreferences) struct {
	Enabled bool `json:"enabled"`
} {
	return struct {
		Enabled bool `json:"enabled"`
	}{m.Enabled()}
}

func handleMailPreference(w http.ResponseWriter, r *http.Request) {
	if !distribution.Internal {
		http.NotFound(w, r)
		return
	}
	store := mailStore.Load()
	if store == nil {
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
		// the push keeps its own timeout and must not die with the page's
		// request
		if err := store.Set(context.Background(), *in.Enabled); err != nil {
			http.Error(w, "unable to report mail preference", http.StatusBadGateway)
			return
		}
	}
	writeJSON(w, mailView(store))
}
