package gateway

import (
	"net/http"
	"slices"
	"strings"

	"github.com/yetone/magpie/internal/provider"
)

// Keep the Agent's own compaction protocol and summary prompt. The gateway
// only hands that request to the same WorkBuddy account's larger transport.
func workBuddyMaasCompaction(c candidate, kind string) bool {
	return kind == KindCompact && c.p.ID == "sub2agent-workbuddy" &&
		strings.Contains(strings.ToLower(c.p.OwnModelID(c.model)), "-maas")
}

func workBuddyPrivateByteBudget(p provider.Provider, body []byte) bool {
	if p.ID != "sub2agent-workbuddy" {
		return false
	}
	model := strings.ToLower(p.OwnModelID(modelOf(body)))
	return strings.Contains(model, "-maas") || model == "hy4free" || model == "deepseek-v4-flash"
}

func workBuddyRescueSelected(p provider.Provider, model string) bool {
	if len(p.Models) > 0 {
		return slices.Contains(p.Models, model)
	}
	// A plugin's default list lives in its live catalog, not p.Models.
	for _, entry := range provider.Served() {
		if entry.Group == "" && entry.Provider.ID == p.ID && entry.Model == model {
			return true
		}
	}
	return false
}

func workBuddyCompactRescue(c candidate, kind string, status int, from provider.Protocol, body []byte, tried []candidate) (candidate, bool) {
	if status != http.StatusRequestEntityTooLarge || !workBuddyMaasCompaction(c, kind) {
		return candidate{}, false
	}
	req, err := parseIn(from, body, true)
	if err != nil || !compacting(req) {
		return candidate{}, false // a kind/header alone must not reroute a turn
	}
	// Both transports accepted >1 MiB in controlled upstream tests. Hy4
	// can spend its entire output on reasoning under a native summary
	// prompt, so keep a verified non-MaaS Flash behind it as well.
	for _, model := range []string{"hy4free", "Deepseek-V4-Flash"} {
		if !workBuddyRescueSelected(c.p, model) || !c.p.AccountServes(c.p.PluginAccountKey(), model) {
			continue
		}
		if slices.ContainsFunc(tried, func(previous candidate) bool {
			return previous.p.ID == c.p.ID && previous.who() == c.who() && previous.model == model
		}) {
			continue
		}
		rescue := c
		rescue.model, rescue.compactRescue = model, true
		rescue.effort, rescue.levels, rescue.effortMap = "", nil, nil
		rescue.fast, rescue.ultra = false, false
		if holds(rescue, estimate(req)) {
			return rescue, true
		}
	}
	return candidate{}, false
}
