//go:build intranet

package provider

import (
	"slices"
	"testing"
)

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
