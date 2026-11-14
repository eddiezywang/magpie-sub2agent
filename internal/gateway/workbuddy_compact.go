package gateway

import (
	"net/http"
	"slices"
	"strings"

	"github.com/tidwall/gjson"
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
	return strings.Contains(model, "-maas") || model == "hy4free"
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
	// Only hy4free may rescue a size-rejected MaaS compaction.
	for _, model := range []string{"hy4free"} {
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

// Hy4free shares its output allowance between reasoning and the summary.
// Small Agent budgets exhausted it on reasoning in native compact probes.
// This floor is internal to rescued summaries, never ordinary inference.
func workBuddyCompactBudget(from provider.Protocol, body []byte) []byte {
	key := "max_tokens"
	switch from {
	case provider.Chat:
		if gjson.GetBytes(body, "max_completion_tokens").Exists() {
			key = "max_completion_tokens"
		}
	case provider.Responses:
		key = "max_output_tokens"
	case provider.Anthropic:
	default:
		return body
	}
	if gjson.GetBytes(body, key).Int() >= 32768 {
		return body
	}
	return withFields(body, map[string]any{key: 32768})
}
