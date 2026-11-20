package gui

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
	"github.com/yetone/magpie/internal/usage"
)

func TestConfiguredUsageSuppliers(t *testing.T) {
	got := configuredUsageSuppliers([]provider.Provider{
		{ID: "aiep-coding-plan-2", Key: "private-fixture"},
		{ID: "cib-zht-apikey"},
		{ID: "sub2agent-workbuddy-cib", Account: &provider.Account{User: "private-fixture"}},
		{ID: "sub2agent-workbuddy-enterprise", Account: &provider.Account{User: "private-fixture"}},
		{ID: "workbuddy", Key: "private-fixture"},
	})
	want := []usageSupplier{
		{ID: "tig", Providers: []string{"aiep-coding-plan-2"}},
		{ID: "workbuddy-enterprise", Providers: []string{"sub2agent-workbuddy-enterprise"}},
		{ID: "workbuddy-cib", Providers: []string{"sub2agent-workbuddy-cib"}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("configured suppliers: %+v, want %+v", got, want)
	}
	encoded, err := json.Marshal(got)
	if err != nil || strings.Contains(string(encoded), "private-fixture") {
		t.Fatal("configuration response included credentials or failed to encode")
	}
}

func TestSupplierUsageRoutesRequireConfiguration(t *testing.T) {
	sandboxHome(t)
	now := holdUsageClock(t, time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC))
	mux := http.NewServeMux()
	usageRoutes(mux, folderOnly{})
	read := func(path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/usage/suppliers"+path, nil))
		return w
	}
	noConfig := read("")
	if distribution.Internal && (noConfig.Code != http.StatusOK || strings.TrimSpace(noConfig.Body.String()) != "[]") ||
		!distribution.Internal && noConfig.Code != http.StatusNotFound {
		t.Fatalf("unconfigured suppliers: %d %s", noConfig.Code, noConfig.Body.String())
	}
	if !distribution.Internal {
		return
	}
	if w := read("/cib"); w.Code != http.StatusNotFound {
		t.Fatalf("unconfigured supplier exposed usage: %d", w.Code)
	}
	const id = "cib-zht-apikey"
	const secret = "fixture-credential-must-not-be-serialized"
	if err := provider.Save(provider.Provider{ID: id, Name: "CIB", Key: secret, Chat: "https://fixture.invalid/chat"}); err != nil {
		t.Fatal(err)
	}
	w := read("")
	if w.Code != http.StatusOK || strings.Contains(w.Body.String(), secret) || !strings.Contains(w.Body.String(), id) {
		t.Fatalf("configured supplier summary: HTTP %d", w.Code)
	}
	usage.Append(usage.Record{Time: now, Provider: id, Model: "glm-5.3-aliyun", Input: 10, Output: 2, CacheRead: 3, CacheWrite: 7, Status: 200})
	w = read("/cib?tz=UTC&days=1")
	var got usage.SupplierUsage
	if err := json.Unmarshal(w.Body.Bytes(), &got); w.Code != http.StatusOK || err != nil || got.Today.Tokens != 22 || len(got.Timeline) != 24 {
		t.Fatalf("configured supplier usage: %d, tokens=%v, buckets=%d (%v)", w.Code, got.Today.Tokens, len(got.Timeline), err)
	}
	if w := read("/cib?channel=zp"); w.Code != http.StatusBadRequest {
		t.Fatalf("CIB accepted a TIG channel: %d", w.Code)
	}
}

func TestTIGUsagePeriodsSeparateObservedAndRolling(t *testing.T) {
	now := time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)
	observations := []gateway.TIGQuotaWindow{
		{Period: "fiveHours", Until: now.Add(time.Hour)},
		{Period: "week", Until: now.Add(-time.Minute)},
	}
	windows, periods := tigUsagePeriods(now, observations)
	if len(periods) != 2 || !periods["fiveHours"].Rolling || !periods["fiveHours"].From.Equal(now.Add(-5*time.Hour)) ||
		!periods["week"].Rolling || !periods["week"].From.Equal(now.Add(-7*24*time.Hour)) || windows[0].Status != "observed" ||
		windows[0].Reset.IsZero() || !windows[0].Start.IsZero() || windows[1].Status != "expired" || !windows[1].Reset.IsZero() {
		t.Fatalf("unknown start or expired reset overstated: %+v %+v", windows, periods)
	}
	start := now.Add(-time.Hour)
	observations[1] = gateway.TIGQuotaWindow{Period: "week", Estimated: true, Until: start.Add(7 * 24 * time.Hour), ObservedAfter: start.Add(-time.Minute)}
	windows, periods = tigUsagePeriods(now, observations)
	if p, ok := periods["week"]; !ok || p.Rolling || !p.From.Equal(start) || windows[1].Status != "estimated" || !windows[1].Start.Equal(start) {
		t.Fatalf("week estimate missing: %+v %+v", windows, periods)
	}
}
