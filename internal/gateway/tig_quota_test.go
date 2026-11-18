package gateway

import (
	"os"
	"path/filepath"
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
