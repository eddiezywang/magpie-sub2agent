//go:build intranet

package plugin

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type marketStatusTransport func(*http.Request) (*http.Response, error)

func (f marketStatusTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestIntranetMarketDistinguishesFailureEmptyAndCache(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	old := http.DefaultClient
	t.Cleanup(func() {
		http.DefaultClient = old
		marketList = nil
		marketAt = time.Time{}
		marketUpdated = time.Time{}
		marketChecked = time.Time{}
		marketErr = nil
	})
	marketList = nil
	marketUpdated = time.Time{}
	mode, calls := "timeout", 0
	http.DefaultClient = &http.Client{Transport: marketStatusTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Hostname() != "172.21.0.177" {
			t.Errorf("unexpected public fallback: %s", r.URL.Hostname())
		}
		if mode == "timeout" {
			return nil, context.DeadlineExceeded
		}
		body := `{"plugins":[]}`
		if mode == "listed" {
			body = `{"plugins":[{"package":"internal-plugin","name":"Internal"}]}`
		}
		if mode == "invalid" {
			body = `<html>proxy error</html>`
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body)), Request: r}, nil
	})}
	ctx := context.Background()
	ls, s := MarketWithStatus(ctx)
	if len(ls) != 0 || s.State != "unavailable" || s.Reason != "timeout" {
		t.Fatalf("timeout hidden as empty: %+v %+v", ls, s)
	}
	MarketWithStatus(ctx)
	if calls != 1 {
		t.Fatalf("failure repeated without retry: %d calls", calls)
	}
	mode = "empty"
	RefreshMarket()
	ls, s = MarketWithStatus(ctx)
	if len(ls) != 0 || s.State != "online" || s.Reason != "" {
		t.Fatalf("healthy empty directory: %+v %+v", ls, s)
	}
	mode = "listed"
	RefreshMarket()
	ls, s = MarketWithStatus(ctx)
	if len(ls) != 1 || s.State != "online" {
		t.Fatalf("online: %+v %+v", ls, s)
	}
	updated := s.UpdatedAt
	mode = "timeout"
	RefreshMarket()
	ls, s = MarketWithStatus(ctx)
	if len(ls) != 1 || s.State != "cached" || s.Reason != "timeout" || s.UpdatedAt.IsZero() {
		t.Fatalf("cached: %+v %+v", ls, s)
	}
	if s.UpdatedAt.Sub(updated) > time.Second {
		t.Fatalf("cache became fresh: %v -> %v", updated, s.UpdatedAt)
	}
	mode = "invalid"
	RefreshMarket()
	ls, s = MarketWithStatus(ctx)
	if len(ls) != 1 || s.State != "cached" || s.Reason != "invalid" {
		t.Fatalf("invalid directory replaced cache: %+v %+v", ls, s)
	}
	mode = "empty"
	RefreshMarket()
	ls, s = MarketWithStatus(ctx)
	if len(ls) != 0 || s.State != "online" || s.Reason != "" {
		t.Fatalf("retry did not recover: %+v %+v", ls, s)
	}
}
