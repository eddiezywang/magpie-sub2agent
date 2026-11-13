package provider

import (
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/plugin"
	"net/url"
)

// The AIEP plan is a key-based Anthropic relay, not a subscription login.
var codingPlanPreset = PresetDef{
	ID: "aiep-coding-plan", Name: "TIG Coding Plan", Icon: "tig-color", Kind: KindRelay,
	Anthropic: "http://172.21.11.82/public",
	Endpoint:  "http://172.21.11.82/public",
	Website:   "http://docs.weoa.com/docs/47kgJOEB8WTo77qV",
	KeysURL:   "https://aiep.weoa.com",
}

func (p Provider) isCodingPlan() bool {
	return distribution.Internal && p.Preset == codingPlanPreset.ID
}

// Updated adapter defaults apply to newly configured endpoints. Saved addresses,
// keys and model selections remain the user's until explicitly edited.
func codingPlanDefinition() PresetDef {
	pr := codingPlanPreset
	if a := plugin.AIEPAdapter(); a != nil {
		if u, err := url.Parse(a.Anthropic); err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil && u.RawQuery == "" && u.Fragment == "" {
			pr.Anthropic = a.Anthropic
			pr.Endpoint = a.Anthropic
		}
		if a.Name != "" {
			pr.Name = "TIG Coding Plan"
		}
		if a.KeysURL != "" {
			pr.KeysURL = a.KeysURL
		}
		if a.Website != "" {
			pr.Website = a.Website
		}
	}
	return pr
}

// CIB ZHT accepts either compatible protocol; the OpenAI URL is a base,
// because the request path is appended by the existing transport.
var zhtPreset = PresetDef{
	ID: "cib-zht-apikey", Name: "CIB-智汇通-APIKEY", Icon: "cib-zht",
	Kind:      KindRelay,
	Anthropic: "http://10.32.33.46:11288/efllmas-agw/anthropicproxy",
	Chat:      "http://10.32.33.46:11288/efllmas-agw/v1",
}

// Distribution policy is checked independently of saved switches. Existing
// provider records remain on disk and cannot re-enable a retired source.
func intranetSourceAllowed(p Provider) bool {
	if !distribution.Internal {
		return true
	}
	if p.Account != nil {
		return p.IsPlugin() && p.Account.plugin.ID == "sub2agent-workbuddy"
	}
	if p.Preset != "" {
		return p.Preset == codingPlanPreset.ID || p.Preset == zhtPreset.ID
	}
	for _, id := range accountIDs {
		if p.ID == id {
			return false
		}
	}
	return p.ID != "sub2agent-codebuddy" && p.ID != "sub2agent-trae"
}
