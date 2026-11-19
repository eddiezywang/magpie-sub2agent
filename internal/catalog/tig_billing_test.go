package catalog

import (
	"testing"
	"time"
)

func TestTIGBillingUsesActiveDurationChannelAndPeak(t *testing.T) {
	active := time.Date(2026, 11, 16, 6, 0, 0, 0, time.UTC) // Monday 14:00 in Beijing.
	tc, hs := 7., 4.5
	b := TIGBilling{managedRouting{Revision: "test-1", Effective: active,
		TIGPeak: &tigPeak{480, []time.Weekday{1, 2, 3, 4, 5}, 14, 18, 1, .5},
		Models: []managedRate{
			{Provider: "aiep-coding-plan*", Deployment: "zp", Model: "glm-5.3-zp",
				Currency: "GLM_POINTS", CreditRates: &creditRates{6.9, 1.7, 24}, Until: active.AddDate(0, 0, 30)},
			{Provider: "aiep-coding-plan*", Deployment: "hs", Model: "glm-5.3-hs", Currency: "VOLC_AFP", Coefficient: &hs},
			{Provider: "aiep-coding-plan*", Deployment: "tc", Model: "glm-5.3-tc", Currency: "TC_POINTS", Coefficient: &tc},
		}}}
	for _, tc := range []struct {
		name, model, served string
		at                  time.Time
		unknown             bool
		ok, offPeak         bool
		amount              float64
	}{
		{"before activation", "glm-5.3-zp", "", active.Add(-time.Second), false, false, false, 0},
		{"peak starts", "vendor/GLM-5.3-openai-zp", "glm-5.3", active, false, true, false, 39.5},
		{"last peak second", "glm-5.3-zp-openai", "glm-5.3-zp", active.Add(4*time.Hour - time.Second), false, true, false, 39.5},
		{"off peak starts", "glm-5.3-zp", "", active.Add(4 * time.Hour), false, true, true, 19.75},
		{"weekend", "glm-5.3-zp", "", active.AddDate(0, 0, 5), false, true, true, 19.75},
		{"unknown cache", "glm-5.3-zp", "", active, true, false, false, 0},
		{"other channel", "glm-5.3-zp", "glm-5.3-tc", active, false, false, false, 0},
		{"other model", "glm-5.3-zp", "glm-5.3-flash", active, false, false, false, 0},
		{"expired rate", "glm-5.3-zp", "", active.AddDate(0, 0, 30), false, false, false, 0},
		{"AFP", "glm-5.3-hs", "", active, true, true, false, 18},
		{"weighted token", "glm-5.3-tc", "", active, true, true, false, 280000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := b.Charge(TIGChargeInput{At: tc.at, Provider: "aiep-coding-plan-2", Model: tc.model,
				Served: tc.served, Tier: "standard", Input: 10000, Write: 10000, Read: 10000, Output: 10000, CacheUnknown: tc.unknown})
			if ok != tc.ok || got.Amount != tc.amount || got.OffPeak != tc.offPeak {
				t.Fatalf("charge: %+v (%v), want %v (%v, off peak %v)", got, ok, tc.amount, tc.ok, tc.offPeak)
			}
		})
	}
}
