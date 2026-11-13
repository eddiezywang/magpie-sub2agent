package provider

import "github.com/yetone/magpie/internal/distribution"

// The AIEP plan is a key-based Anthropic relay, not a subscription login.
var codingPlanPreset = PresetDef{
	ID: "aiep-coding-plan", Name: "行内 Coding Plan", Icon: "generic", Kind: KindRelay,
	Anthropic: "http://172.21.11.82/public",
	Endpoint:  "http://172.21.11.82/public",
	Website:   "http://docs.weoa.com/docs/47kgJOEB8WTo77qV",
	KeysURL:   "https://aiep.weoa.com",
}

func (p Provider) isCodingPlan() bool {
	return distribution.Internal && p.Preset == codingPlanPreset.ID
}
