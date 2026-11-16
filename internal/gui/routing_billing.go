package gui

import (
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/provider"
	"strings"
)

func routingBilling(p provider.Provider, model string) *catalog.RoutingBilling {
	if !distribution.Internal {
		return nil
	}
	b := catalog.RoutingBillingOf(p.ID, model)
	if b.State == "unknown" && !strings.HasPrefix(p.ID, "sub2agent-workbuddy") && p.Preset != "aiep-coding-plan" {
		return nil
	}
	return &b
}
