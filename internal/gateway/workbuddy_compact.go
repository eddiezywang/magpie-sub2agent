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

func workBuddyCompactionBody(p provider.Provider, proto provider.Protocol, body []byte) bool {
	if p.ID != "sub2agent-workbuddy" {
		return false
	}
	req, err := parse(proto, body)
	return err == nil && compacting(req)
}

func workBuddyCompactRescue(c candidate, kind string, status int, from provider.Protocol, body []byte, tried []candidate) (candidate, bool) {
	if status != http.StatusRequestEntityTooLarge || !workBuddyMaasCompaction(c, kind) ||
		!slices.Contains(c.p.Models, "hy4free") || !c.p.AccountServes(c.p.PluginAccountKey(), "hy4free") {
		return candidate{}, false
	}
	for _, previous := range tried {
		if previous.p.ID == c.p.ID && previous.who() == c.who() && previous.model == "hy4free" {
			return candidate{}, false // never cycle between MaaS and its rescue
		}
	}
	req, err := parse(from, body)
	if err != nil || !compacting(req) {
		return candidate{}, false // a kind/header alone must not reroute a turn
	}
	rescue := c
	rescue.model, rescue.compactRescue = "hy4free", true
	rescue.effort, rescue.levels, rescue.effortMap = "", nil, nil
	rescue.fast, rescue.ultra = false, false
	if !holds(rescue, estimate(req)) {
		return candidate{}, false
	}
	return rescue, true
}
