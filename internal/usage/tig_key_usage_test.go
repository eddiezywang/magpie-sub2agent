package usage

import (
	"testing"
	"time"

	"github.com/yetone/magpie/internal/catalog"
)

type tigKeyFixture struct{ at time.Time }

func (f tigKeyFixture) Effective() time.Time { return f.at }
func (f tigKeyFixture) Revision() string     { return "fixture" }
func (f tigKeyFixture) Charge(in catalog.TIGChargeInput) (catalog.TIGCharge, bool) {
	return catalog.TIGCharge{Amount: float64(in.Input)}, !in.At.Before(f.at) && !in.CacheUnknown
}

func TestTIGKeyUsageDoesNotBorrowChargesOrHistory(t *testing.T) {
	now := time.Date(2026, 11, 19, 10, 0, 0, 0, time.UTC)
	providerID := "aiep-coding-plan"
	row := func(ago time.Duration, key, channel string, input, status int) Record {
		return Record{Time: now.Add(-ago), Provider: providerID, ProviderKeyID: key, Model: "glm-5.3-" + channel, Input: input, Status: status}
	}
	periods := map[string]TIGKeyPeriod{"fiveHours": {From: now.Add(-5 * time.Hour), Rolling: true}, "week": {From: now.Add(-7 * 24 * time.Hour)}}
	rows := []Record{
		row(time.Hour, "one", "zp", 10, 200), row(time.Hour, "two", "zp", 50, 200),
		row(time.Hour, "one", "hs", 900, 200), row(time.Hour, "one", "zp", 0, 429),
		row(time.Hour, "one", "zp", 3, 502), row(6*time.Hour, "", "zp", 80, 200),
		row(48*time.Hour, "one", "zp", 20, 200),
	}
	got := foldTIGKeyUsage(now, now.Add(-30*time.Hour), providerID, "one", periods, tigKeyFixture{now.Add(-24 * time.Hour)}, func(yield func(Record)) {
		for _, r := range rows {
			yield(r)
		}
	})
	five, week := got.Periods["fiveHours"], got.Periods["week"]
	if !five.Complete || !five.Rolling || five.Points != 13 || five.Priced != 2 ||
		week.Complete || week.Rolling || week.Points != 13 || week.Priced != 2 || week.Uncovered != 2 {
		t.Fatalf("unexpected periods: %+v", got)
	}
}
