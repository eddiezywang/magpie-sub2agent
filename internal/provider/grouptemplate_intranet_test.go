//go:build intranet

package provider

import (
	"slices"
	"testing"
)

func TestInternalEvenModelPreferences(t *testing.T) {
	ms := []rated{
		tm("tig", "glm-5.3-flash-zp", 2, true, "2026-09-20"),
		tm("wb", "glm-5.3-flash-maas", 2, true, "2026-09-20"),
		tm("tig", "glm-5.3-zp-openai", 20, true, "2026-09-20"),
		tm("wb", "glm-5.3-maas", 20, true, "2026-09-20"),
		tm("other", "unrelated-pro", 50, true, "2026-10-20"),
	}
	for _, tc := range []struct {
		kind    string
		indices []int
	}{
		{"even-glm53-flash", []int{0, 1}}, {"even-glm53", []int{2, 3}},
	} {
		t.Run(tc.kind, func(t *testing.T) {
			tp := templateOf(tc.kind, ms, nil)
			if tp.Need != "" || tp.Group.Routing != Rotate || tp.Group.Affinity != AffinitySession ||
				!slices.Equal(tp.Group.Members, []string{ms[tc.indices[0]].e.ID, ms[tc.indices[1]].e.ID}) {
				t.Fatalf("model preference selected wrong models or affinity: %+v", tp)
			}
			one := templateOf(tc.kind, ms[tc.indices[0]:tc.indices[0]+1], nil)
			if one.Need != NeedProviders || len(one.Group.Members) != 0 {
				t.Fatalf("single source accepted as balanced pair: %+v", one)
			}
			missing := templateOf(tc.kind, ms[4:], nil)
			if missing.Need == "" || len(missing.Group.Members) != 0 {
				t.Fatalf("silently substituted unrelated model: %+v", missing)
			}
		})
	}
}

func TestInternalEvenPreferencesPersistAndRecover(t *testing.T) {
	azureHome(t)
	p := Provider{ID: "tig", Key: "fixture", Chat: "http://127.0.0.1:19999/v1", Models: []string{"glm-5.3-flash-zp", "glm-5.3-zp"}}
	q := Provider{ID: "wb", Key: "fixture", Chat: "http://127.0.0.1:19998/v1", Models: []string{"glm-5.3-flash-maas", "glm-5.3-maas"}}
	for _, p := range []Provider{p, q} {
		if err := Save(p); err != nil {
			t.Fatal(err)
		}
	}
	for _, kind := range []string{TemplateEvenGLMFlash, TemplateEvenGLM} {
		if _, err := AddTemplate(kind, ""); err != nil {
			t.Fatal(err)
		}
	}
	check := func(n int) {
		t.Helper()
		found := 0
		for _, g := range Groups() {
			if g.TemplateKind != TemplateEvenGLMFlash && g.TemplateKind != TemplateEvenGLM {
				continue
			}
			found++
			if len(g.Members) != n || g.Affinity != AffinitySession || g.Routing != Rotate {
				t.Fatalf("saved preference did not retain its contract: %+v", g)
			}
		}
		if found != 2 {
			t.Fatalf("lost saved preference: %d", found)
		}
	}
	check(2)
	q.Off = true
	if err := Save(q); err != nil {
		t.Fatal(err)
	}
	check(0)
	q.Off = false
	if err := Save(q); err != nil {
		t.Fatal(err)
	}
	check(2)
}

func TestInternalEvenGroupsDeploymentAliasesAcrossSources(t *testing.T) {
	for _, tigID := range []string{"glm-5.3-flash-zp", "glm-5.3-flash-zp-openai"} {
		t.Run(tigID, func(t *testing.T) {
			tig := tm("sub2agent-tigcodingplan", tigID, 2, true, "2026-09-20")
			wb := tm("sub2agent-workbuddy", "glm-5.3-flash-maas", 2, true, "2026-09-20")
			g := templateOf(TemplateEven, []rated{tig, wb}, nil).Group
			if g.Routing != Rotate || !slices.Equal(g.Members, []string{tig.e.ID, wb.e.ID}) {
				t.Fatalf("deployment aliases must rotate across both original source IDs, got %+v", g)
			}
			if tig.e.Model != tigID || wb.e.Model != "glm-5.3-flash-maas" {
				t.Fatal("grouping rewrote upstream request model IDs")
			}
			for _, different := range []string{"glm-5.3-pro-maas", "glm-5.2-flash-zp", "glm-5.3-flash-lite-zp"} {
				if bareModel(different) == bareModel(tigID) {
					t.Fatalf("distinct model %s merged with %s", different, tigID)
				}
			}
		})
	}
}

func TestInternalTemplatesUseUpstreamPrerequisites(t *testing.T) {
	plan := tm("sub2agent-workbuddy", "gpt-6.1", 40, true, "2026-09-20")
	plan.e.Provider.Account = &Account{Agent: "plugin", User: "fixture"}
	cheap := tm("sub2agent-workbuddy", "gpt-6-mini", 4, true, "2026-07-01")
	cheap.e.Provider = plan.e.Provider
	for _, kind := range []string{TemplatePlan, TemplateSteady, TemplateFast} {
		tp := templateOf(kind, []rated{plan, cheap}, nil)
		if tp.Need != NeedProviders || len(tp.Group.Members) != 0 {
			t.Fatalf("%s accepted two models as two providers: %+v", kind, tp)
		}
	}
	for _, kind := range []string{TemplateSmart, TemplateThrifty, TemplateEven} {
		if tp := templateOf(kind, []rated{plan, cheap}, nil); tp.Why != "" {
			t.Fatalf("%s incorrectly requires two providers: %+v", kind, tp)
		}
	}
	other := tm("relay", "gpt-6.1", 40, true, "2026-09-20")
	if tp := templateOf(TemplatePlan, []rated{other, plan, cheap}, nil); tp.Why != "" || !slices.Equal(tp.Group.Members, []string{plan.e.ID, other.e.ID}) {
		t.Fatalf("wrong plan recipe: %+v", tp)
	}
}

func TestInternalSavedPlanInvalidatesAndRecoversWithoutRewritingFile(t *testing.T) {
	azureHome(t)
	p := Provider{ID: "sub2agent-tigcodingplan", Preset: "aiep-coding-plan", Key: "fixture", Chat: "http://127.0.0.1:19999/v1", Models: []string{"glm-5.3-flash-zp"}}
	q := Provider{ID: "relay", Key: "fixture", Chat: "http://127.0.0.1:19998/v1", Models: []string{"gpt-6.1"}}
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	if _, err := AddTemplate(TemplatePlan, ""); err == nil {
		t.Fatal("created plan with one source")
	}
	if err := Save(q); err != nil {
		t.Fatal(err)
	}
	g, err := AddTemplate(TemplatePlan, "")
	if err != nil {
		t.Fatal(err)
	}
	check := func(want int) {
		t.Helper()
		for _, next := range Groups() {
			if next.ID == g.ID {
				if len(next.Members) != want {
					t.Fatalf("members %v, want count %d", next.Members, want)
				}
				return
			}
		}
		t.Fatal("group lost")
	}
	check(2)
	q.Off = true
	if err := Save(q); err != nil {
		t.Fatal(err)
	}
	check(0)
	if err := SwitchGroup(g.ID, true); err == nil {
		t.Fatal("enabled stale plan after source disabled")
	}
	f, err := read()
	if err != nil {
		t.Fatal(err)
	}
	for _, stored := range f.Groups {
		if stored.ID == g.ID && len(stored.Members) != 2 {
			t.Fatal("invalidating template overwrote saved config")
		}
	}
	q.Off = false
	if err := Save(q); err != nil {
		t.Fatal(err)
	}
	check(2)
	for _, next := range Groups() {
		if next.ID == g.ID {
			g = next
		}
	}
	if err := SaveGroup(g); err != nil {
		t.Fatal(err)
	}
	q.Off = true
	if err := Save(q); err != nil {
		t.Fatal(err)
	}
	for _, next := range Groups() {
		if next.ID == g.ID && (next.TemplateKind != "" || len(next.Members) != 2) {
			t.Fatal("manual edit was regenerated")
		}
	}
}
