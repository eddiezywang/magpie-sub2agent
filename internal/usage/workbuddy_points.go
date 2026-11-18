package usage

import (
	"strings"

	"github.com/yetone/magpie/internal/catalog"
)

// WorkBuddyMaaSPoints estimates the plan charge for a retained request using
// the active managed coefficient. Vendor-reported credits take precedence.
func WorkBuddyMaaSPoints(r Record) (float64, bool) {
	if r.Credits != nil || !strings.HasPrefix(r.Provider, "sub2agent-workbuddy") {
		return 0, false
	}
	model := r.Served
	if model == "" {
		model = r.Model
	}
	if !strings.Contains(strings.ToLower(model), "-maas") {
		return 0, false
	}
	bill := catalog.RoutingBillingOf(r.Provider, model)
	return maasPointsAt(r, bill)
}

func maasPointsAt(r Record, bill catalog.RoutingBilling) (float64, bool) {
	if bill.State != "active" || bill.Currency != "POINTS" || bill.Coefficient == nil {
		return 0, false
	}
	tokens := r.Input + r.Output + r.CacheRead + r.CacheWrite
	if tokens <= 0 || r.CacheUnknown {
		return 0, false
	}
	return float64(tokens) * (*bill.Coefficient), true
}
