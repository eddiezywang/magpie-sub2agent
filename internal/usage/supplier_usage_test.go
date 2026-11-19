package usage

import (
	"fmt"
	"testing"
	"time"
)

func TestSupplierUsageByModelAndCalendarDay(t *testing.T) {
	zone := time.FixedZone("UTC+8", 8*60*60)
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, zone)
	credit := 1.5
	records := []Record{
		{Time: now.Add(-10 * time.Hour).UTC(), Model: "glm-5.3-zp", Input: 10, CacheRead: 20, CacheWrite: 5, Output: 7, Credits: &credit},
		{Time: now.Add(-11 * time.Hour).UTC(), Model: "other-openai-zp", Input: 8, Output: 4, CacheUnknown: true},
		{Time: now.AddDate(0, 0, -1), Model: "glm-5.3-zp-openai", Input: 100},
		{Time: now.AddDate(0, 0, -40), Model: "glm-5.3-zp", Input: 200},
		{Time: now, Model: "glm-5.3-hs", Input: 900},
		{Time: now, Model: "glm-5.3-zp", Input: 900, Source: SourceReported},
		{Time: now, Model: "glm-5.3-zp", Input: 900, Computer: "another"},
		{Time: now, Model: "glm-5.3-zp", Input: 900, Rejected: true},
		{Time: now.Add(time.Second), Model: "glm-5.3-zp", Input: 900},
	}
	got := foldSupplierUsage(now, records[3].Time, "zp", 1, func(yield func(Record)) {
		for _, record := range records {
			yield(record)
		}
	})
	if got.Selected.Tokens != 54 || got.Week.Tokens != 154 || got.Month.Tokens != 154 || got.Total.Tokens != 354 {
		t.Fatalf("token periods: %+v / %+v / %+v / %+v", got.Selected, got.Week, got.Month, got.Total)
	}
	if got.Selected.KnownPrompt != 35 || got.Selected.CacheRead != 20 || got.Selected.Credits != credit || got.Selected.Credited != 1 {
		t.Fatalf("cache and vendor credit: %+v", got.Selected)
	}
	if len(got.Timeline) != 24 || len(got.Timeline[2].Models) != 1 || got.Timeline[2].Models[0].ID != "glm-5.3-zp" || len(got.Models) != 2 {
		t.Fatalf("expected the two models in separate hour buckets: %+v", got.Timeline)
	}
	if got.Peak == nil || got.Peak.Tokens != 200 || got.Streak != 2 || got.Longest != 2 {
		t.Fatalf("activity: peak=%v streak=%d longest=%d", got.Peak, got.Streak, got.Longest)
	}
}

func TestSupplierUsageLimitsSeriesWithoutLosingTokens(t *testing.T) {
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)
	got := foldSupplierUsage(now, now, "", 7, func(yield func(Record)) {
		for i := 0; i < 20; i++ {
			yield(Record{Time: now, Model: fmt.Sprintf("m%02d", i), Input: 10})
		}
	})
	if got.Selected.Tokens != 200 || len(got.Models) != supplierModelLimit+1 {
		t.Fatalf("total or model limit lost: %+v", got.Models)
	}
	for _, row := range got.Timeline[6].Models {
		if row.ID == "" && row.Tokens == 40 {
			return
		}
	}
	t.Fatal("remaining models were not included in the day bucket")
}
