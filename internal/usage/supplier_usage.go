package usage

import (
	"cmp"
	"slices"
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/provider"
)

const supplierModelLimit = 16

// SupplierUsage summarizes the current gateway ledger for one configured source.
type SupplierUsage struct {
	From         string           `json:"from"`
	To           string           `json:"to"`
	LedgerFrom   *time.Time       `json:"ledgerFrom,omitempty"`
	RateRevision string           `json:"rateRevision,omitempty"`
	RateFrom     time.Time        `json:"rateFrom,omitzero"`
	AsOf         time.Time        `json:"asOf"`
	Today        SupplierCounters `json:"today"`
	Week         SupplierCounters `json:"week"`
	Month        SupplierCounters `json:"month"`
	Total        SupplierCounters `json:"total"`
	Selected     SupplierCounters `json:"selected"`
	Activity     []TokenDay       `json:"activity"`
	Peak         *TokenDay        `json:"peak,omitempty"`
	Streak       int              `json:"streak"`
	Longest      int              `json:"longest"`
	Models       []SupplierModel  `json:"models"`
	Timeline     []SupplierBucket `json:"timeline"`
}

type SupplierCounters struct {
	Tokens        int64   `json:"tokens"`
	Calls         int     `json:"calls"`
	CacheRead     int64   `json:"cacheRead"`
	KnownPrompt   int64   `json:"knownPrompt"`
	Credits       float64 `json:"credits"`
	Credited      int     `json:"credited"`
	MaaSPoints    float64 `json:"maasPoints"`
	MaaSCovered   int     `json:"maasCovered"`
	TIGAmount     float64 `json:"tigAmount,omitempty"`
	TIGCovered    int     `json:"tigCovered,omitempty"`
	TIGUnpriced   int     `json:"tigUnpriced,omitempty"`
	TIGTokens     int64   `json:"tigTokens,omitempty"`
	OffPeakTokens int64   `json:"offPeakTokens,omitempty"`
}

func (t *SupplierCounters) add(d SupplierCounters) {
	t.Tokens += d.Tokens
	t.Calls += d.Calls
	t.CacheRead += d.CacheRead
	t.KnownPrompt += d.KnownPrompt
	t.Credits += d.Credits
	t.Credited += d.Credited
	t.MaaSPoints += d.MaaSPoints
	t.MaaSCovered += d.MaaSCovered
	t.TIGAmount += d.TIGAmount
	t.TIGCovered += d.TIGCovered
	t.TIGUnpriced += d.TIGUnpriced
	t.TIGTokens += d.TIGTokens
	t.OffPeakTokens += d.OffPeakTokens
}

type SupplierModel struct {
	ID string `json:"id"` // empty identifies the aggregate of remaining models
	SupplierCounters
}

type SupplierBucket struct {
	Time   time.Time       `json:"time"`
	Models []SupplierModel `json:"models"`
}

// SupplierUsageOf uses the shared ledger index. The hourly buckets start at
// local midnight and follow elapsed hours, including repeated DST hours.
func SupplierUsageOf(ids map[string]bool, channel string, days int, zone *time.Location) SupplierUsage {
	if zone == nil {
		zone = time.Local
	}
	ledger := readLogSnapshot()
	renames, cleared := provider.UsageRenames(), readCleared()
	now := Clock().In(zone)
	var rates catalog.TIGBilling
	if channel != "" {
		rates = catalog.ReadTIGBilling(now)
	}
	return foldSupplierUsage(now, cleared.clearedSince(ledger.firstOwn), channel, days, rates, func(yield func(Record)) {
		ledger.visit(time.Time{}, func(r Record) {
			r.renameBy(renames)
			if ids[r.Provider] && !cleared.hides(&r) {
				yield(r)
			}
		})
	})
}

// TIGModelChannel recognizes both spellings of the protocol suffix without
// treating a model maker's name as a deployment identifier.
func TIGModelChannel(id string) string {
	_, channel := catalog.TIGModel(id)
	return channel
}

func foldSupplierUsage(now, first time.Time, channel string, days int, rates tigKeyPricer, visit func(func(Record))) SupplierUsage {
	if days != 1 && days != 7 && days != 30 {
		days = 7
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	start, week, month := today.AddDate(0, 0, 1-days), today.AddDate(0, 0, -6), today.AddDate(0, 0, -29)
	activityStart := heatmapSince(now)
	out := SupplierUsage{From: start.Format(time.DateOnly), To: today.Format(time.DateOnly),
		Activity: []TokenDay{}, Models: []SupplierModel{}, Timeline: []SupplierBucket{},
		RateRevision: rates.Revision(), RateFrom: rates.Effective(), AsOf: now}
	if !first.IsZero() {
		out.LedgerFrom = &first
	}
	models := map[string]SupplierCounters{}
	activity := map[string]int64{}
	timeline := newSupplierTimeline(start, today, days == 1)
	visit(func(r Record) {
		if r.Time.After(now) || !currentGatewayRecord(r) || channel != "" && TIGModelChannel(r.Model) != channel {
			return
		}
		d := supplierCounters(r)
		out.Total.add(d)
		if !r.Time.Before(today) {
			out.Today.add(d)
		}
		if !r.Time.Before(week) {
			out.Week.add(d)
		}
		if !r.Time.Before(month) {
			out.Month.add(d)
		}
		if d.Tokens > 0 && !r.Time.Before(activityStart) {
			activity[r.Time.In(now.Location()).Format(time.DateOnly)] += d.Tokens
		}
		if r.Time.Before(start) {
			return
		}
		if channel != "" && (d.Tokens > 0 || !r.Failed()) {
			if c, ok := rates.Charge(tigChargeInput(r)); ok && d.Tokens > 0 {
				d.TIGAmount, d.TIGCovered, d.TIGTokens = c.Amount, 1, d.Tokens
				if c.OffPeak {
					d.OffPeakTokens = d.Tokens
				}
			} else {
				d.TIGUnpriced = 1
			}
		}
		out.Selected.add(d)
		model := cmp.Or(r.Served, r.Model)
		if channel != "" {
			model = r.Model
		}
		addSupplierModel(models, model, d)
		timeline.add(r.Time, model, d)
	})
	for date := activityStart; !date.After(today); date = date.AddDate(0, 0, 1) {
		label := date.Format(time.DateOnly)
		tokens := activity[label]
		if tokens > 0 {
			out.Streak++
			out.Longest = max(out.Longest, out.Streak)
			if out.Peak == nil || tokens > out.Peak.Tokens {
				out.Peak = &TokenDay{Date: label, Tokens: tokens}
			}
		} else {
			out.Streak = 0
		}
		out.Activity = append(out.Activity, TokenDay{Date: label, Tokens: tokens})
	}
	out.Models = sortedSupplierModels(models)
	keep := map[string]bool{}
	for i, model := range out.Models {
		if i >= supplierModelLimit || model.ID == "" {
			continue
		}
		keep[model.ID] = true
	}
	out.Models = limitedSupplierModels(models, keep)
	for i, bucket := range timeline.buckets {
		out.Timeline = append(out.Timeline, SupplierBucket{Time: timeline.times[i], Models: limitedSupplierModels(bucket, keep)})
	}
	return out
}

func currentGatewayRecord(r Record) bool {
	return r.Computer == "" && SourceOf(Row{Record: r, Source: r.Source}) == SourceGateway
}

func supplierCounters(r Record) SupplierCounters {
	d := SupplierCounters{Calls: 1, Tokens: int64(r.Input) + int64(r.Output) + int64(r.CacheRead) + int64(r.CacheWrite)}
	if !r.CacheUnknown {
		d.CacheRead = int64(r.CacheRead)
		d.KnownPrompt = int64(r.Input) + int64(r.CacheRead) + int64(r.CacheWrite)
	}
	if r.Credits != nil {
		d.Credits, d.Credited = *r.Credits, 1
	}
	if points, ok := WorkBuddyMaaSPoints(r); ok {
		d.MaaSPoints, d.MaaSCovered = points, 1
	}
	return d
}

func addSupplierModel(m map[string]SupplierCounters, name string, d SupplierCounters) {
	total := m[name]
	total.add(d)
	m[name] = total
}

func sortedSupplierModels(m map[string]SupplierCounters) []SupplierModel {
	models := make([]SupplierModel, 0, len(m))
	for id, total := range m {
		models = append(models, SupplierModel{ID: id, SupplierCounters: total})
	}
	slices.SortFunc(models, func(a, b SupplierModel) int {
		return cmp.Or(cmp.Compare(b.Tokens, a.Tokens), cmp.Compare(a.ID, b.ID))
	})
	return models
}

func limitedSupplierModels(m map[string]SupplierCounters, keep map[string]bool) []SupplierModel {
	limited := make(map[string]SupplierCounters, len(keep))
	for id, total := range m {
		if !keep[id] {
			id = ""
		}
		addSupplierModel(limited, id, total)
	}
	return sortedSupplierModels(limited)
}

type supplierTimeline struct {
	times   []time.Time
	buckets []map[string]SupplierCounters
	dates   map[string]int
	hourly  bool
}

func newSupplierTimeline(start, today time.Time, hourly bool) supplierTimeline {
	s := supplierTimeline{hourly: hourly, dates: map[string]int{}}
	for at := start; at.Before(today.AddDate(0, 0, 1)); {
		s.dates[at.Format(time.DateOnly)] = len(s.times)
		s.times = append(s.times, at)
		s.buckets = append(s.buckets, map[string]SupplierCounters{})
		if hourly {
			at = at.Add(time.Hour)
		} else {
			at = at.AddDate(0, 0, 1)
		}
	}
	return s
}

func (s supplierTimeline) add(at time.Time, model string, d SupplierCounters) {
	i := s.dates[at.In(s.times[0].Location()).Format(time.DateOnly)]
	if s.hourly {
		i = int(at.Sub(s.times[0]) / time.Hour)
	}
	if i >= 0 && i < len(s.buckets) {
		addSupplierModel(s.buckets[i], model, d)
	}
}
