package usage

import (
	"time"

	"github.com/yetone/magpie/internal/provider"
)

// TokenTrend counts gateway tokens from the retained Usage ledger.
type TokenTrend struct {
	Today  int64      `json:"today"`
	Week   int64      `json:"week"`
	Month  int64      `json:"month"`
	Total  int64      `json:"total"`
	Series []TokenDay `json:"series"`
}

type TokenDay struct {
	Date   string `json:"date"`
	Tokens int64  `json:"tokens"`
}

// ProviderTokenTrend returns calendar-day totals in the overview's time zone.
func ProviderTokenTrend(ids map[string]bool, zone *time.Location) TokenTrend {
	renamed, cleared := provider.UsageRenames(), readCleared()
	return tokenTrend(Clock().In(zone), func(emit func(Record)) {
		readLogSnapshot().visit(time.Time{}, func(r Record) {
			r.renameBy(renamed)
			if ids[r.Provider] && !cleared.hides(&r) {
				emit(r)
			}
		})
	})
}

func tokenTrend(now time.Time, visit func(func(Record))) TokenTrend {
	const days = 30
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	from := today.AddDate(0, 0, 1-days)
	trend := TokenTrend{Series: make([]TokenDay, days)}
	byDate := make(map[string]int, days)
	for i := range trend.Series {
		date := from.AddDate(0, 0, i).Format(time.DateOnly)
		trend.Series[i].Date = date
		byDate[date] = i
	}
	visit(func(r Record) {
		if r.Time.After(now) || SourceOf(Row{Record: r, Source: r.Source}) != SourceGateway {
			return
		}
		tokens := int64(r.Input) + int64(r.Output) + int64(r.CacheRead) + int64(r.CacheWrite)
		trend.Total += tokens
		if r.Time.Before(from) {
			return
		}
		if i, ok := byDate[r.Time.In(now.Location()).Format(time.DateOnly)]; ok {
			trend.Series[i].Tokens += tokens
		}
	})
	trend.Today = trend.Series[days-1].Tokens
	for i, day := range trend.Series {
		trend.Month += day.Tokens
		if i >= days-7 {
			trend.Week += day.Tokens
		}
	}
	return trend
}
