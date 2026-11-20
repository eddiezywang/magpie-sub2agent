package usage

import (
	"time"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/provider"
)

// TIGKeyPeriod is either an observed estimate or an explicitly labelled
// rolling reference. The estimate ends at the time the data is read.
type TIGKeyPeriod struct {
	From    time.Time
	Rolling bool
}

type TIGKeyEstimate struct {
	From      time.Time `json:"from"`
	Rolling   bool      `json:"rolling,omitempty"`
	Points    float64   `json:"points"`
	Priced    int       `json:"priced"`
	Uncovered int       `json:"uncovered"`
	Complete  bool      `json:"complete"`
}

type TIGKeyUsage struct {
	Revision   string                    `json:"revision,omitempty"`
	LedgerFrom time.Time                 `json:"ledgerFrom,omitzero"`
	Periods    map[string]TIGKeyEstimate `json:"periods"`
}

func TIGKeyUsageOf(now time.Time, providerID, keyID string, periods map[string]TIGKeyPeriod) TIGKeyUsage {
	s := readLogSnapshot()
	rates := catalog.ReadTIGBilling(now)
	renames, cleared := provider.UsageRenames(), readCleared()
	var since time.Time
	for _, p := range periods {
		if since.IsZero() || p.From.Before(since) {
			since = p.From
		}
	}
	return foldTIGKeyUsage(now, cleared.clearedSince(s.firstOwn), providerID, keyID, periods, rates, cleared.hides, func(yield func(Record)) {
		if len(periods) == 0 {
			return
		}
		s.visit(since, func(r Record) {
			r.renameBy(renames)
			yield(r)
		})
	})
}

type tigKeyPricer interface {
	Effective() time.Time
	Revision() string
	Charge(catalog.TIGChargeInput) (catalog.TIGCharge, bool)
}

func foldTIGKeyUsage(now, first time.Time, providerID, keyID string, periods map[string]TIGKeyPeriod, rates tigKeyPricer, cleared func(*Record) bool, visit func(func(Record))) TIGKeyUsage {
	out := TIGKeyUsage{Revision: rates.Revision(), LedgerFrom: first, Periods: make(map[string]TIGKeyEstimate, len(periods))}
	effective := rates.Effective()
	for name, p := range periods {
		complete := !first.IsZero() && !first.After(p.From) && !effective.IsZero() && !effective.After(p.From)
		out.Periods[name] = TIGKeyEstimate{From: p.From, Rolling: p.Rolling, Complete: complete}
	}
	visit(func(r Record) {
		if r.Provider != providerID || r.Time.After(now) || !currentGatewayRecord(r) ||
			TIGModelChannel(r.Model) != "zp" || r.ProviderKeyID != "" && r.ProviderKeyID != keyID {
			return
		}
		measurable := hasTIGTokens(r)
		if !measurable && r.Failed() {
			return
		}
		hidden := cleared(&r)
		charge, priced := catalog.TIGCharge{}, false
		if !hidden && measurable && r.ProviderKeyID != "" {
			charge, priced = rates.Charge(tigChargeInput(r))
		}
		for name, e := range out.Periods {
			if r.Time.Before(e.From) {
				continue
			}
			if hidden {
				e.Complete = false
			} else if priced {
				e.Points += charge.Amount
				e.Priced++
			} else {
				e.Uncovered++
				e.Complete = false
			}
			out.Periods[name] = e
		}
	})
	return out
}

func hasTIGTokens(r Record) bool {
	return r.Input > 0 || r.Output > 0 || r.CacheRead > 0 || r.CacheWrite > 0
}

func tigChargeInput(r Record) catalog.TIGChargeInput {
	return catalog.TIGChargeInput{
		At: r.Time, Provider: r.Provider, Model: r.Model, Served: r.Served,
		Tier: r.TierServed, Input: r.Input, Read: r.CacheRead, Write: r.CacheWrite,
		Output: r.Output, CacheUnknown: r.CacheUnknown,
	}
}
