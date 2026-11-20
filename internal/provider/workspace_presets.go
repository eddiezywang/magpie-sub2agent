package provider

import (
	"errors"
	"sync"

	"github.com/yetone/magpie/internal/catalog"
)

// Explicit capability tiers, independent of provider, price and point cost.
// Unknown models remain available for manual groups, never guessed by suffix.
var workspaceTiers = map[string][]string{
	"flash-first":    {"glm-5.3-flash", "deepseek-v4.1-flash", "deepseek-v4-flash", "hy3", "glm-5.2-flash", "gemini-3-flash", "gemini-2.5-flash", "doubao-seed-2.1-lite", "doubao-seed-2.0-mini", "claude-haiku-4-5", "gpt-5-mini"},
	"flagship-first": {"glm-5.3", "deepseek-v4-pro", "minimax-m3", "doubao-seed-2.1-pro", "glm-5.2", "kimi-k3", "gemini-3-pro", "claude-opus-4-5", "claude-opus-4-6", "gpt-5", "gpt-6.1"},
}

func workspaceTemplate(kind string, ms []rated) Template {
	t := Template{Kind: kind, Group: Group{ID: TemplateIDs[kind], Name: TemplateNames[kind], Routing: Rotate, Affinity: AffinitySession}}
	ids := workspaceTiers[kind]
	tierIDs := make(map[string]bool)
	for _, models := range workspaceTiers {
		for _, id := range models {
			tierIDs[catalog.SameModel(id)] = true
		}
	}
	keys := make([]string, len(ms))
	// Prefer a shared model, then the designated tier at other providers.
	by := map[string]map[string]bool{}
	for i, m := range ms {
		key := catalog.LongestModelPrefix(catalog.SameModel(m.e.Model), func(id string) bool { return tierIDs[id] })
		keys[i] = key
		if key == "" {
			continue
		}
		if by[key] == nil {
			by[key] = map[string]bool{}
		}
		by[key][m.e.Provider.ID] = true
	}
	shared := ""
	for _, id := range ids {
		if len(by[catalog.SameModel(id)]) >= 2 {
			shared = catalog.SameModel(id)
			break
		}
	}
	chosen := map[string]Entry{}
	var order []string
	for _, m := range ms {
		pid := m.e.Provider.ID
		if _, ok := chosen[pid]; !ok {
			order = append(order, pid)
			chosen[pid] = Entry{}
		}
	}
	preferred := ids
	if shared != "" {
		preferred = append([]string{shared}, ids...)
	}
	for _, id := range preferred {
		for i, m := range ms {
			if chosen[m.e.Provider.ID].ID == "" && keys[i] == catalog.SameModel(id) {
				chosen[m.e.Provider.ID] = m.e
			}
		}
	}
	for _, pid := range order {
		if e := chosen[pid]; e.ID != "" {
			t.Group.Members = append(t.Group.Members, e.ID)
		}
		if len(t.Group.Members) == 4 {
			break
		}
	}
	if len(t.Group.Members) == 0 {
		t.Need, t.Of, t.Why = NeedModel, TemplateNames[kind], "no recognized model in this capability tier"
	}
	return t
}

var workspacePresetMu sync.Mutex

// EnsureTemplate only runs for an explicit configuration action, never a read.
func EnsureTemplate(kind string) (Group, error) {
	workspacePresetMu.Lock()
	defer workspacePresetMu.Unlock()
	if _, err := MakeTemplate(kind); err != nil {
		return Group{}, err
	}
	for _, g := range Groups() {
		if g.TemplateKind == kind {
			if g.Disabled {
				return Group{}, errors.New("Routing group is disabled")
			}
			if len(g.Members) > 0 {
				return g, nil
			}
		}
	}
	return AddTemplate(kind, "")
}
