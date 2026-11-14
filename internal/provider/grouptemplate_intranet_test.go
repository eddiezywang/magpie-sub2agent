//go:build intranet

package provider

import (
	"encoding/json"
	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/catalog"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"
)

func TestInternalRoutingTemplateSet(t *testing.T) {
	if !slices.Equal(availableTemplateKinds(), []string{TemplatePlan, TemplateSmart, TemplateThrifty, TemplateSteady}) {
		t.Fatal("internal routing templates differ from the four supported choices")
	}
	if (Provider{Preset: "aiep-coding-plan"}).BillingKind() != BillingPlan {
		t.Fatal("TIG Coding Plan not classified as a plan")
	}
}

func TestInternalCheapFallbackWithoutManagedPrices(t *testing.T) {
	ms := []rated{
		tm("sub2agent-workbuddy", "Deepseek-V4-Flash", 1, true, "2026-11-01"),
		tm("sub2agent-workbuddy", "glm-5.3-flash-maas-tenant", 3, true, "2026-11-01"),
		tm("sub2agent-workbuddy", "hy4free", 0, false, ""),
	}
	ms[2].priced = false
	g := internalTemplate(TemplateThrifty, ms, nil).Group
	want := []string{ms[2].e.ID, ms[1].e.ID, ms[0].e.ID}
	if !slices.Equal(g.Members, want) {
		t.Fatalf("offline cheap order %v, want %v", g.Members, want)
	}
	if g.Routing != Ordered {
		t.Fatal("cheap template must follow the displayed order")
	}
}

func TestInternalPlanAndPriceTemplatesFollowServerScores(t *testing.T) {
	azureHome(t)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	file := appdir.Join(appdir.Cache(), "routing-catalog.json")
	os.MkdirAll(filepath.Dir(file), 0700)
	setScore := func(free float64) {
		raw, _ := json.Marshal(map[string]any{"revision": "fixture", "expires_at": time.Now().Add(time.Hour), "models": []map[string]any{{"provider": "sub2agent-workbuddy*", "model": "hy4free", "score": free}, {"provider": "sub2agent-workbuddy*", "model": "glm-5.3-flash-maas", "score": 1}, {"provider": "sub2agent-workbuddy*", "model": "deepseek-v4-flash-maas", "score": 2}, {"provider": "sub2agent-tigcodingplan*", "model": "glm-*", "score": 1}}})
		os.WriteFile(file, raw, 0600)
		catalog.Reset()
	}
	setScore(0)
	ms := []rated{tm("sub2agent-workbuddy", "deepseek-v4-flash", 8, true, "2026-11-01"), tm("sub2agent-workbuddy", "glm-5.3-flash-maas-fixture", 1, true, "2026-11-01"), tm("sub2agent-workbuddy", "hy4free", 0, true, ""), tm("sub2agent-tigcodingplan", "glm-5.3-flash-zp", 1, true, "2026-11-01"), tm("sub2agent-tigcodingplan", "glm-5.3-zp", 7, true, "2026-11-01")}
	ms[3].e.Provider.Preset = "aiep-coding-plan"
	ms[4].e.Provider.Preset = "aiep-coding-plan"
	for i := range ms {
		score, ok := catalog.RoutingScore(ms[i].e.Provider.ID, ms[i].e.Model)
		if ok {
			ms[i].out, ms[i].priced, ms[i].managed = score, true, true
		}
	}
	plan := templateOf(TemplatePlan, ms, nil)
	if plan.Group.Members[0] != "sub2agent-tigcodingplan/glm-5.3-flash-zp" || plan.Group.Members[1] != "sub2agent-workbuddy/hy4free" {
		t.Fatalf("wrong plan fallback: %v", plan.Group.Members)
	}
	cheap := templateOf(TemplateThrifty, ms, nil)
	if cheap.Group.Members[0] != "sub2agent-workbuddy/hy4free" {
		t.Fatal("free promotion not first")
	}
	setScore(3)
	for i := range ms {
		score, ok := catalog.RoutingScore(ms[i].e.Provider.ID, ms[i].e.Model)
		if ok {
			ms[i].out = score
		}
	}
	cheap = templateOf(TemplateThrifty, ms, nil)
	if cheap.Group.Members[0] == "sub2agent-workbuddy/hy4free" {
		t.Fatal("ended free price still pinned")
	}
}

func TestInternalTemplateGroupUpdatesDiscoveryAndManualEditOptsOut(t *testing.T) {
	azureHome(t)
	p := Provider{ID: "sub2agent-tigcodingplan", Preset: "aiep-coding-plan", Key: "fixture", Chat: "http://127.0.0.1:19999/v1", Models: []string{"glm-5.3-flash-zp"}}
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	g, err := AddTemplate(TemplatePlan, "")
	if err != nil {
		t.Fatal(err)
	}
	if g.TemplateKind != TemplatePlan {
		t.Fatal("template is frozen")
	}
	p.Models = []string{"glm-5.4-flash-zp"}
	if err = Save(p); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, next := range Groups() {
		if next.ID == g.ID {
			g = next
			found = slices.Contains(next.Members, p.ID+"/glm-5.4-flash-zp")
		}
	}
	if !found {
		t.Fatal("managed template did not follow discovery")
	}
	if err = SaveGroup(g); err != nil {
		t.Fatal(err)
	}
	for _, next := range Groups() {
		if next.ID == g.ID && next.TemplateKind != "" {
			t.Fatal("manual edit did not opt out")
		}
	}
}
