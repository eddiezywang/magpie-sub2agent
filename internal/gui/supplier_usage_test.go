package gui

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
)

func TestConfiguredUsageSuppliers(t *testing.T) {
	got := configuredUsageSuppliers([]provider.Provider{
		{ID: "aiep-coding-plan-2", Key: "private-fixture"},
		{ID: "cib-zht-apikey"},
		{ID: "sub2agent-workbuddy-cib", Key: "private-fixture"},
		{ID: "sub2agent-workbuddy-enterprise", Key: "private-fixture"},
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

func TestTIGUsagePeriodsSeparateObservedAndRolling(t *testing.T) {
	now := time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)
	observations := []gateway.TIGQuotaWindow{
		{Period: "fiveHours", Until: now.Add(time.Hour)},
		{Period: "week", Until: now.Add(-time.Minute)},
	}
	windows, periods := tigUsagePeriods(now, observations)
	if len(periods) != 1 || !periods["fiveHours"].Rolling || windows[0].Status != "observed" ||
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
