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
// Rename moves group/settings references and retains Was for running agents.
func repairImportedCodingPlans() (int, error) {
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
		if strings.HasPrefix(p.ID, "legacy-") {
			to := FreeID("sub2agent-tigcodingplan")
			if err := Rename(p.ID, to); err != nil {
				return count, err
			}
			// Re-read the record after Rename: preserve its alias and any other
			// fields changed by the shared migration, including old routing IDs.
			next, err := read()
			if err != nil {
				return count, err
			}
			for _, saved := range next.Providers {
				if saved.ID == to {
					p = saved
					break
				}
			}
			changed = true
		}
		if p.Preset != codingPlanPreset.ID || p.Name != "TIG Coding Plan" || p.Icon != codingPlanPreset.Icon || p.AuthHeader != AuthBearer {
			p.Preset = codingPlanPreset.ID
			p.Name = "TIG Coding Plan"
			p.Icon = codingPlanPreset.Icon
			p.AuthHeader = AuthBearer
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
