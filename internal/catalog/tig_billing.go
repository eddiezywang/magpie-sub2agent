package catalog

import (
	"math"
	"slices"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/filememo"
)

type tigPeak struct {
	Offset  int            `json:"utc_offset_minutes"`
	Days    []time.Weekday `json:"weekdays"`
	Start   int            `json:"start_hour"`
	End     int            `json:"end_hour"`
	Peak    float64        `json:"peak_factor"`
	OffPeak float64        `json:"off_peak_factor"`
}

func (p *tigPeak) valid() bool {
	return p != nil && p.Offset >= -840 && p.Offset <= 840 && p.Start >= 0 &&
		p.Start < p.End && p.End <= 24 && len(p.Days) > 0 && len(p.Days) <= 7 &&
		!slices.ContainsFunc(p.Days, func(w time.Weekday) bool { return w < time.Sunday || w > time.Saturday }) &&
		p.Peak > 0 && p.OffPeak > 0 && !math.IsInf(p.Peak, 0) && !math.IsInf(p.OffPeak, 0)
}

func (p *tigPeak) at(t time.Time) bool {
	local := t.UTC().Add(time.Duration(p.Offset) * time.Minute)
	return local.Hour() >= p.Start && local.Hour() < p.End && slices.Contains(p.Days, local.Weekday())
}

// TIGModel splits accounting identity from deployment. The original ID is
// retained in the ledger and the request sent upstream.
func TIGModel(id string) (model, channel string) {
	id = strings.ToLower(id[strings.LastIndexByte(id, '/')+1:])
	for _, ch := range []string{"zp", "hs", "tc"} {
		for _, suffix := range []string{"-openai-" + ch + "-openai", "-openai-" + ch, "-" + ch + "-openai", "-" + ch} {
			if model, ok := strings.CutSuffix(id, suffix); ok {
				return model, ch
			}
		}
	}
	return id, ""
}

// TIGBilling holds the active immutable snapshot used for one ledger read.
type TIGBilling struct{ policy managedRouting }

func ReadTIGBilling(now time.Time) TIGBilling {
	d, err := filememo.Read("managed-routing", managedRoutingPath(), parseManagedRouting)
	if err != nil || !now.Before(d.Expires) || d.Effective.After(now) || d.Effective.IsZero() {
		return TIGBilling{}
	}
	return TIGBilling{d}
}

func (b TIGBilling) Effective() time.Time { return b.policy.Effective }
func (b TIGBilling) Revision() string     { return b.policy.Revision }

type TIGChargeInput struct {
	At                         time.Time
	Provider, Model, Served    string
	Tier                       string
	Input, Read, Write, Output int
	CacheUnknown               bool
}

type TIGCharge struct {
	Amount  float64
	OffPeak bool
}

func (b TIGBilling) Charge(c TIGChargeInput) (TIGCharge, bool) {
	model, channel := TIGModel(c.Model)
	if channel == "" || b.policy.Effective.IsZero() || c.At.Before(b.policy.Effective) {
		return TIGCharge{}, false
	}
	if served, servedChannel := TIGModel(c.Served); served != "" && (served != model || servedChannel != "" && servedChannel != channel) {
		return TIGCharge{}, false
	}
	var fallback *managedRate
	for i := range b.policy.Models {
		r := &b.policy.Models[i]
		if r.Deployment != channel || !routingMatch(r.Provider, c.Provider) {
			continue
		}
		// Use the billing service's ordered, case-insensitive rule match.
		base, _ := TIGModel(strings.TrimSuffix(r.Model, "*"))
		if strings.HasSuffix(r.Model, "*") {
			base += "*"
		}
		if !routingMatch(base, model) {
			continue
		}
		if r.ServiceTier == c.Tier {
			return b.charge(c, r)
		}
		if c.Tier == "standard" && r.ServiceTier == "" && fallback == nil {
			fallback = r
		}
	}
	if fallback != nil {
		return b.charge(c, fallback)
	}
	return TIGCharge{}, false
}

func (b TIGBilling) charge(c TIGChargeInput, r *managedRate) (TIGCharge, bool) {
	if !r.Until.IsZero() && !c.At.Before(r.Until) || len(r.Above) > 0 {
		return TIGCharge{}, false
	}
	if r.Deployment == "zp" && r.Currency == "GLM_POINTS" && r.CreditRates != nil && !c.CacheUnknown && b.policy.TIGPeak.valid() {
		rates, peak := r.CreditRates, b.policy.TIGPeak
		factor, offPeak := peak.Peak, !peak.at(c.At)
		if offPeak {
			factor = peak.OffPeak
		}
		amount := ((float64(c.Input)+float64(c.Write))*rates.Input +
			float64(c.Read)*rates.CacheRead + float64(c.Output)*rates.Output) / 10000 * factor
		return TIGCharge{Amount: amount, OffPeak: offPeak}, !math.IsInf(amount, 0)
	}
	if r.Coefficient == nil {
		return TIGCharge{}, false
	}
	total := float64(c.Input) + float64(c.Read) + float64(c.Write) + float64(c.Output)
	if factor := r.AfternoonFactor; factor != nil {
		if !b.policy.TIGPeak.valid() || *factor < 0 || math.IsInf(*factor, 0) {
			return TIGCharge{}, false
		}
		if b.policy.TIGPeak.at(c.At) {
			total *= *factor
		}
	}
	switch {
	case r.Deployment == "hs" && r.Currency == "VOLC_AFP":
		amount := total * *r.Coefficient / 10000
		return TIGCharge{Amount: amount}, !math.IsInf(amount, 0)
	case r.Deployment == "tc" && r.Currency == "TC_POINTS":
		amount := total * *r.Coefficient
		return TIGCharge{Amount: amount}, !math.IsInf(amount, 0)
	}
	return TIGCharge{}, false
}
