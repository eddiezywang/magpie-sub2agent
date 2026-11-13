package provider

import (
	"slices"
	"testing"
)

func TestTemplateKnownZeroPriceAndPromotionEnd(t *testing.T) {
	strong := tm("plan", "capable-model", 30, true, "2026-11-01")
	cheap := tm("api", "capable-model-mini", 3, true, "2026-10-01")
	promo := tm("subscription", "promotion-model", 0, false, "2026-11-01")
	promo.priced = true
	ms := []rated{strong, cheap, promo}
	if got := cheapest(ms, strong); len(got) == 0 || got[0].e.ID != promo.e.ID {
		t.Fatal("known zero price not selected")
	}
	if got := classifierFor(ms, nil, promo); got != promo.e.ID {
		t.Fatalf("classifier ignored zero-priced eligible model: %s", got)
	}
	// A revised price removes the promotion without a hard-coded model rule.
	ms[2].out = 20
	if got := cheapest(ms, strong); len(got) == 0 || got[0].e.ID != cheap.e.ID {
		t.Fatal("ended promotion still treated as free")
	}
	unknown := promo
	unknown.priced = false
	if slices.ContainsFunc(cheapest([]rated{strong, unknown}, strong), func(r rated) bool { return r.e.ID == unknown.e.ID }) {
		t.Fatal("unknown zero interpreted as free")
	}
}
