package usage

import (
	"testing"
	"time"
)

func TestTokenTrendCalendarWindows(t *testing.T) {
	zone := time.FixedZone("UTC+8", 8*60*60)
	now := time.Date(2026, 11, 19, 12, 0, 0, 0, zone)
	midnight := now.Add(-12 * time.Hour)
	records := []Record{
		{Time: midnight.UTC(), Input: 10, Output: 20, CacheRead: 30, CacheWrite: 40},
		{Time: midnight.Add(-time.Second), Input: 1},
		{Time: midnight.AddDate(0, 0, -6), Input: 2},
		{Time: midnight.AddDate(0, 0, -7), Input: 4},
		{Time: midnight.AddDate(0, 0, -29), Input: 8},
		{Time: midnight.AddDate(0, 0, -30), Input: 16},
		{Time: now.Add(time.Second), Input: 1000},
		{Time: midnight, Input: 1000, Rejected: true},
		{Time: midnight, Input: 1000, Source: SourceReported},
		{Time: midnight, Input: 1000, Source: SourceProbe},
		{Time: midnight, Input: 1000, Source: SourceMCP},
	}
	got := tokenTrend(now, func(emit func(Record)) {
		for _, record := range records {
			emit(record)
		}
	})
	if got.Today != 100 || got.Week != 103 || got.Month != 115 || got.Total != 131 {
		t.Fatalf("today/week/month/total = %d/%d/%d/%d, want 100/103/115/131", got.Today, got.Week, got.Month, got.Total)
	}
	if len(got.Series) != 30 || got.Series[0] != (TokenDay{"2026-10-21", 8}) ||
		got.Series[1] != (TokenDay{"2026-10-22", 0}) || got.Series[29] != (TokenDay{"2026-11-19", 100}) {
		t.Fatalf("invalid daily series: %+v", got.Series)
	}
}
