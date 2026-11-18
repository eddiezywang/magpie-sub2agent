package usage

import (
	"testing"

	"github.com/yetone/magpie/internal/catalog"
)

func TestWorkBuddyMaaSPointsUseManagedCoefficient(t *testing.T) {
	coefficient := 2.5
	bill := catalog.RoutingBilling{State: "active", Currency: "POINTS", Coefficient: &coefficient}
	row := Record{Input: 10, Output: 20, CacheRead: 30, CacheWrite: 40, CacheWrite1h: 15, Reasoning: 5}
	points, ok := maasPointsAt(row, bill)
	if !ok || points != 250 {
		t.Fatalf("got %v (%v), want 250 estimated points", points, ok)
	}
	row.CacheUnknown = true
	if _, ok := maasPointsAt(row, bill); ok {
		t.Fatal("unknown cache usage was priced")
	}
	row.CacheUnknown = false
	bill.Currency = "USD"
	if _, ok := maasPointsAt(row, bill); ok {
		t.Fatal("dollar price was counted as points")
	}
	row.Provider = "sub2agent-workbuddy"
	row.Model = "glm-5.3-flash-maas"
	row.Credits = &coefficient
	if _, ok := WorkBuddyMaaSPoints(row); ok {
		t.Fatal("vendor-reported credits would be counted twice")
	}
}
