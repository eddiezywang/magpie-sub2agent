package gateway

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/provider"
)

func TestTIGQuotaWindows(t *testing.T) {
	now := time.Date(2026, 11, 18, 8, 0, 0, 0, time.UTC)
	body := []byte(`{"error":{"code":"1310","message":"已达到 7 天使用上限，2026-11-19 10:25:24 后可继续使用。"}}`)
	period, until := tigQuotaReset(body, now)
	if period != "week" || !until.Equal(time.Date(2026, 11, 19, 2, 25, 24, 0, time.UTC)) || busy(429, body) {
		t.Fatalf("weekly quota: %s %v, should not enter transient retries", period, until)
	}
	c := candidate{p: provider.Provider{ID: "aiep-coding-plan-fixture", Key: "fixture-one"}, model: "glm-5.3-flash-zp"}
	key := tigQuotaKey(c)
	if key == "" {
		t.Fatal("missing quota key")
	}
	if err := os.MkdirAll(filepath.Dir(provider.Path()), 0700); err != nil {
		t.Fatal(err)
	}
	if _, ok := tigQuotaRest(c, now); ok {
		t.Fatal("unknown window rested")
	}
	updateTIGWindows(key, period, until, time.Time{})
	five := now.Add(time.Hour)
	updateTIGWindows(key, "fiveHours", five, time.Time{})
	if rest, ok := tigQuotaRest(c, now); !ok || !rest.Until.Equal(until) {
		t.Fatalf("longer window lost: %+v", rest)
	}
	first := five.Add(5 * time.Minute)
	updateTIGWindows(key, "", time.Time{}, first)
	updateTIGWindows(key, "", time.Time{}, first.Add(time.Minute))
	tigWindows.Lock()
	tigWindows.path = ""
	loadTIGWindows()
	state := tigWindows.data[key]["fiveHours"]
	tigWindows.Unlock()
	if !state.Estimated || !state.Until.Equal(first.Add(5*time.Hour)) {
		t.Fatalf("persisted estimate: %+v", state)
	}
	c.model = "glm-5.3-flash-hs"
	if _, ok := tigQuotaRest(c, now); ok {
		t.Fatal("unrelated channel was held")
	}
}

func TestTIGKeyUsages(t *testing.T) {
	p := provider.Provider{ID: "aiep-coding-plan-window-fixture", Key: "fixture-window-first",
		Keys: []provider.KeyAccount{
			{Key: "fixture-window-second", Name: "Team"},
			{Key: "fixture-window-off", Off: true},
			{Key: "fixture-window-second"},
			{Key: "fixture-window-unobserved"},
		}}
	if err := os.MkdirAll(filepath.Dir(provider.Path()), 0700); err != nil {
		t.Fatal(err)
	}
	keys := p.KeysOn()
	firstID, secondID := provider.KeyID(keys[0].Key), provider.KeyID(keys[1].Key)
	now := time.Date(2026, 11, 18, 8, 0, 0, 0, time.UTC)
	firstEnd, secondEnd := now.Add(time.Hour), now.Add(6*24*time.Hour)
	for i, observation := range []struct {
		period string
		end    time.Time
	}{{"fiveHours", firstEnd}, {"week", secondEnd}} {
		key := tigQuotaKey(candidate{p: p.WithKey(keys[i]), model: "glm-5.3-flash-zp"})
		updateTIGWindows(key, observation.period, observation.end, time.Time{})
	}
	got := TIGKeyUsages(p)
	if len(got) != 3 || got[0].ID != firstID || got[1].ID != secondID || got[1].Name != "Team" {
		t.Fatalf("enabled keys out of order: %+v", got)
	}
	if !got[0].Windows[0].Until.Equal(firstEnd) || !got[0].Windows[1].Until.IsZero() ||
		!got[1].Windows[0].Until.IsZero() || !got[1].Windows[1].Until.Equal(secondEnd) ||
		!got[2].Windows[0].Until.IsZero() || !got[2].Windows[1].Until.IsZero() {
		t.Fatalf("windows leaked across keys: %+v", got)
	}
	data, err := json.Marshal(got)
	if err != nil || strings.Contains(string(data), "fixture-window-") {
		t.Fatalf("unsafe window response (%v)", err)
	}
	if legacy := TIGQuotaWindows(p); legacy != nil {
		t.Fatal("legacy reader mixed multiple keys")
	}
	p.Keys = nil
	if legacy := TIGQuotaWindows(p); len(legacy) != 2 || !legacy[0].Until.Equal(firstEnd) {
		t.Fatalf("legacy single-key window was lost: %+v", legacy)
	}
}

func TestTIGFiveHourWindowOpensOnSuccessfulUse(t *testing.T) {
	p := provider.Provider{ID: "aiep-coding-plan-idle-fixture", Key: "fixture-idle-first",
		Keys: []provider.KeyAccount{{Key: "fixture-idle-second"}}}
	c := candidate{p: p, model: "glm-5.3-openai-zp"}
	key := tigQuotaKey(c)
	first := time.Date(2026, 11, 19, 8, 0, 0, 0, time.UTC)
	if err := os.MkdirAll(filepath.Dir(provider.Path()), 0700); err != nil {
		t.Fatal(err)
	}
	check := func(end time.Time, estimated bool) {
		t.Helper()
		w := TIGKeyUsages(p)
		if w[0].Windows[0].Estimated != estimated || !w[0].Windows[0].Until.Equal(end) ||
			!w[0].Windows[1].Until.IsZero() || !w[1].Windows[0].Until.IsZero() {
			t.Fatalf("five-hour observation changed the wrong window or key: %+v", w)
		}
	}
	updateTIGWindows(key, "", time.Time{}, first)
	check(first.Add(5*time.Hour), true)
	updateTIGWindows(key, "", time.Time{}, first.Add(time.Hour))
	check(first.Add(5*time.Hour), true)
	next := first.Add(5 * time.Hour)
	updateTIGWindows(key, "", time.Time{}, next)
	// A request from the previous window can finish later without moving
	// the new window back across its lower bound.
	updateTIGWindows(key, "", time.Time{}, next.Add(-time.Second))
	check(next.Add(5*time.Hour), true)
	if _, ok := tigQuotaRest(c, next.Add(time.Minute)); ok {
		t.Fatal("an estimated window must not block routing")
	}
	recovery := next.Add(4 * time.Hour)
	updateTIGWindows(key, "fiveHours", recovery, time.Time{})
	check(recovery, false)
	if rest, ok := tigQuotaRest(c, recovery.Add(-time.Second)); !ok || !rest.Until.Equal(recovery) {
		t.Fatalf("confirmed quota rest lost: %+v", rest)
	}
	updateTIGWindows(key, "", time.Time{}, recovery)
	check(recovery.Add(5*time.Hour), true)
}
