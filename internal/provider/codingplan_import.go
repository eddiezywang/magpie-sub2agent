package provider

import (
	"net/url"
	"strings"

	"github.com/yetone/magpie/internal/distribution"
)

// Recognize only the managed TIG host and its documented API bases. Never
// classify an arbitrary endpoint by a substring or by the key's spelling.
func knownCodingPlanEndpoint(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || u.Host != "172.21.11.82" {
		return false
	}
	switch strings.TrimRight(u.Path, "/") {
	case "/public", "/public/v1", "/public/v1/messages", "/public/v1/chat/completions", "/public/v1/responses":
		return true
	}
	return false
}

// Revisit imports made by older builds even when the old application is no
// longer installed or its one-shot import marker has already been written.
// Keep IDs and routing references unchanged when correcting their identity.
func RepairImportedCodingPlans() (int, error) {
	if !distribution.Internal {
		return 0, nil
	}
	f, err := read()
	if err != nil {
		return 0, err
	}
	count := 0
	for _, p := range f.Providers {
		if !strings.HasPrefix(p.ID, "legacy-") && !strings.HasPrefix(p.ID, "sub2agent-tigcodingplan") {
			continue
		}
		if p.Preset != "" && p.Preset != codingPlanPreset.ID {
			continue
		}
		if !knownCodingPlanEndpoint(p.Chat) && !knownCodingPlanEndpoint(p.Anthropic) && !knownCodingPlanEndpoint(p.Responses) {
			continue
		}
		changed := false
		if p.Preset != codingPlanPreset.ID {
			p.Preset = codingPlanPreset.ID
			changed = true
		}
		if p.Name == "我的 API" || p.Name == "API" || p.Name == "Sub2Agent 来源" {
			p.Name = "TIG-Coding-Plan"
			changed = true
		}
		if p.Icon == "" || p.Icon == "generic" {
			p.Icon = codingPlanPreset.Icon
			changed = true
		}
		if changed {
			if err := Save(p); err != nil {
				return count, err
			}
			count++
		}
	}
	return count, nil
}
