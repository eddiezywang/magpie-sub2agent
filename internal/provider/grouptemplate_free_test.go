package provider

import (
	"slices"
	"testing"
)

func TestTemplateZeroUsesUpstreamSmallModelEligibility(t *testing.T) {
	strong := tm("plan", "capable-model", 30, true, "2026-11-01")
	cheap := tm("api", "capable-model-mini", 3, true, "2026-10-01")
	promo := tm("subscription", "promotion-model", 0, false, "2026-11-01")
	ms := []rated{strong, cheap, promo}
	if got := cheapest(ms, strong); len(got) == 0 || got[0].e.ID != cheap.e.ID {
		t.Fatal("zero value overrode upstream cheap-model definition")
	}
	if got := classifierFor(ms, nil, cheap); got != cheap.e.ID {
		t.Fatalf("classifier differs from upstream: %s", got)
	}
	// A revised price removes the promotion without a hard-coded model rule.
	ms[2].out = 20
	if got := cheapest(ms, strong); len(got) == 0 || got[0].e.ID != cheap.e.ID {
		t.Fatal("ended promotion still treated as free")
	}
	unknown := promo
	if slices.ContainsFunc(cheapest([]rated{strong, unknown}, strong), func(r rated) bool { return r.e.ID == unknown.e.ID }) {
		t.Fatal("unknown zero interpreted as free")
	}
}
