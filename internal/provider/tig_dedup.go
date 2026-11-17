package provider

import (
	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/distribution"
	"strings"
)

// Only collapse protocol aliases in the default exposure, not the available
// model list or explicit picks. Each retained ID is still sent as discovered.
func tigDefaultModels(p Provider, models []catalog.Model) []catalog.Model {
	if !distribution.Internal || !(p.Preset == "aiep-coding-plan" || strings.HasPrefix(p.ID, "sub2agent-tigcodingplan") || strings.HasPrefix(p.ID, "aiep-coding-plan")) {
		return models
	}
	key := func(id string) string {
		s := strings.ToLower(id)
		for _, channel := range []string{"zp", "tc", "hs"} {
			if strings.HasSuffix(s, "-openai-"+channel) {
				s = strings.TrimSuffix(s, "-openai-"+channel) + "-" + channel
			}
			if strings.HasSuffix(s, "-"+channel+"-openai") {
				s = strings.TrimSuffix(s, "-openai")
			}
		}
		return s
	}
	preferred := map[string]string{}
	for _, m := range models {
		k := key(m.ID)
		if preferred[k] == "" || strings.EqualFold(m.ID, k) {
			preferred[k] = m.ID
		}
	}
	out := make([]catalog.Model, 0, len(models))
	for _, m := range models {
		if preferred[key(m.ID)] == m.ID {
			out = append(out, m)
		}
	}
	return out
}
