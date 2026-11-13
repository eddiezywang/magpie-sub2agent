package provider

import (
	"cmp"
	"slices"
)

// Internal templates use model facts and managed relative prices. No template
// is tied to a specific upstream model ID. Ordered fallback returns to the
// first model after its quota rest expires through the existing gateway path.
func internalTemplate(kind string, ms []rated, ds []Entry) Template {
	t := Template{Kind: kind, Group: Group{ID: TemplateIDs[kind], Name: TemplateNames[kind], Routing: Ordered}}
	if len(ms) == 0 {
		t.Why, t.Need = "no provider", NeedProvider
		return t
	}
	strong := strongest(ms)
	if len(strong) == 0 {
		t.Why, t.Need = "no model", NeedProvider
		return t
	}
	cheap := slices.Clone(ms)
	slices.SortStableFunc(cheap, func(a, b rated) int {
		return cmp.Or(-cmp.Compare(btoi(a.priced), btoi(b.priced)), cmp.Compare(a.out, b.out), -cmp.Compare(btoi(a.managed), btoi(b.managed)), cmp.Compare(btoi(a.tiny), btoi(b.tiny)), -cmp.Compare(a.e.Released, b.e.Released))
	})
	add := func(m rated) {
		if !slices.Contains(t.Group.Members, m.e.ID) {
			t.Group.Members = append(t.Group.Members, m.e.ID)
		}
	}
	switch kind {
	case TemplatePlan:
		plans := slices.Clone(cheap)
		slices.SortStableFunc(plans, func(a, b rated) int {
			return cmp.Or(-cmp.Compare(btoi(a.e.Provider.isCodingPlan()), btoi(b.e.Provider.isCodingPlan())), -cmp.Compare(btoi(a.e.Provider.BillingKind() == BillingPlan), btoi(b.e.Provider.BillingKind() == BillingPlan)), -cmp.Compare(btoi(a.small && !a.tiny), btoi(b.small && !b.tiny)))
		})
		if plans[0].e.Provider.BillingKind() != BillingPlan {
			t.Why, t.Need = "no plan provider", NeedPlan
			return t
		}
		add(plans[0])
		// A low-cost model on another source comes immediately after the plan;
		// avoid exhausting other plan models before the cheap fallback.
		for _, m := range cheap {
			if m.e.Provider.ID != plans[0].e.Provider.ID {
				add(m)
			}
		}
		for _, m := range plans {
			add(m)
		}
	case TemplateThrifty:
		for _, m := range cheap {
			add(m)
		}
	case TemplateSteady:
		seen := map[string]bool{}
		for _, m := range strong {
			if !seen[m.e.Provider.ID] {
				seen[m.e.Provider.ID] = true
				add(m)
			}
		}
		for _, m := range cheap {
			add(m)
		}
	case TemplateSmart:
		best, low := strong[0], cheap[0]
		if best.e.ID == low.e.ID && len(strong) > 1 {
			best = strong[1]
		}
		add(best)
		add(low)
		if best.e.ID != low.e.ID {
			t.Group.Rules = []Rule{{Use: low.e.ID, Compact: true}, {Use: best.e.ID, Intent: IntentHard}, {Use: low.e.ID, Intent: IntentEasy}}
			if best.e.Images && !low.e.Images {
				t.Group.Rules = append(t.Group.Rules, Rule{Use: best.e.ID, Images: true})
			}
			t.Group.Classifier = classifierFor(ms, ds, low)
		}
		for _, m := range cheap {
			add(m)
		}
	default:
		t.Why = "unsupported internal template"
	}
	return t
}
