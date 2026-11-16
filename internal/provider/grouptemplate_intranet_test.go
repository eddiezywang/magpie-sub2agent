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

func TestInternalPointsChangeOrderWithoutChangingCapability(t *testing.T) {
	azureHome(t)
	ms := []rated{tm("sub2agent-workbuddy", "glm-5.3-flash-maas", 1, true, "2026-11-01"), tm("sub2agent-workbuddy", "deepseek-v4-pro-maas", 20, true, "2026-11-01")}
	one, seven := 1.0, 7.0
	ms[0].billing = catalog.RoutingBilling{State: "active", Currency: "POINTS", Coefficient: &seven}
	ms[1].billing = catalog.RoutingBilling{State: "active", Currency: "POINTS", Coefficient: &one}
	if got := internalTemplate(TemplateThrifty, ms, nil).Group.Members[0]; got != ms[1].e.ID {
		t.Fatalf("ignored points: %s", got)
	}
	strongBefore := strongest(ms)[0].e.ID
	ms[0].billing.Coefficient = &one
	ms[1].billing.Coefficient = &seven
	if got := internalTemplate(TemplateThrifty, ms, nil).Group.Members[0]; got != ms[0].e.ID {
		t.Fatalf("did not follow changed points: %s", got)
	}
	if strongest(ms)[0].e.ID != strongBefore {
		t.Fatal("point price changed capability rank")
	}
	ms[0].billing.State = "expired"
	if got := internalTemplate(TemplateThrifty, ms, nil).Group.Members[0]; got != ms[1].e.ID {
		t.Fatalf("expired rule still selected over known points: %s", got)
	}
}

func TestInternalDifferentCurrenciesUseSourcePreference(t *testing.T) {
	ms := []rated{tm("sub2agent-workbuddy", "points", 1, true, ""), tm("tig", "plan", 1, true, "")}
	low, high := 0.01, 1000.0
	ms[0].billing = catalog.RoutingBilling{State: "active", Currency: "POINTS", Coefficient: &low}
	ms[1].billing = catalog.RoutingBilling{State: "active", Currency: "PLAN_TOKENS", Coefficient: &high}
	if got := internalTemplate(TemplateThrifty, ms, nil).Group.Members[0]; got != ms[1].e.ID {
		t.Fatalf("compared unrelated coefficients as money: %s", got)
	}
}

func TestInternalCheapFallbackWithoutManagedPrices(t *testing.T) {
	ms := []rated{
		tm("sub2agent-workbuddy", "Deepseek-V4-Flash", 1, true, "2026-11-01"),
		tm("sub2agent-workbuddy", "glm-5.3-flash-maas-tenant", 3, true, "2026-11-01"),
		tm("sub2agent-workbuddy", "hy4free", 0, false, ""),
	}
	ms[0].priced, ms[1].priced, ms[2].priced = true, true, false
	g := internalTemplate(TemplateThrifty, ms, nil).Group
	// Unknown point costs never become free because of a model's name.
	want := []string{ms[0].e.ID, ms[1].e.ID, ms[2].e.ID}
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
		raw, _ := json.Marshal(map[string]any{"revision": "fixture", "expires_at": time.Now().Add(time.Hour), "models": []map[string]any{{"provider": "sub2agent-workbuddy*", "model": "hy4free", "score": free, "currency": "POINTS", "coefficient": free}, {"provider": "sub2agent-workbuddy*", "model": "glm-5.3-flash-maas", "score": 1, "currency": "POINTS", "coefficient": 1}, {"provider": "sub2agent-workbuddy*", "model": "deepseek-v4-flash-maas", "score": 2, "currency": "POINTS", "coefficient": 2}, {"provider": "sub2agent-tigcodingplan*", "model": "glm-*", "score": 1, "currency": "POINTS", "coefficient": 1}}})
		os.WriteFile(file, raw, 0600)
		catalog.Reset()
	}
	setScore(0)
	ms := []rated{tm("sub2agent-workbuddy", "deepseek-v4-flash", 8, true, "2026-11-01"), tm("sub2agent-workbuddy", "glm-5.3-flash-maas-fixture", 1, true, "2026-11-01"), tm("sub2agent-workbuddy", "hy4free", 0, true, ""), tm("sub2agent-tigcodingplan", "glm-5.3-flash-zp", 1, true, "2026-11-01"), tm("sub2agent-tigcodingplan", "glm-5.3-zp", 7, true, "2026-11-01")}
	ms[3].e.Provider.Preset = "aiep-coding-plan"
	ms[4].e.Provider.Preset = "aiep-coding-plan"
	for i := range ms {
		_, ok := catalog.RoutingScore(ms[i].e.Provider.ID, ms[i].e.Model)
		if ok {
			ms[i].billing = catalog.RoutingBillingOf(ms[i].e.Provider.ID, ms[i].e.Model)
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
		_, ok := catalog.RoutingScore(ms[i].e.Provider.ID, ms[i].e.Model)
		if ok {
			ms[i].billing = catalog.RoutingBillingOf(ms[i].e.Provider.ID, ms[i].e.Model)
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

func TestInternalSavedTemplateRebuildsAfterBillingCacheReload(t *testing.T) {
	azureHome(t)
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	p := Provider{ID: "sub2agent-tigcodingplan", Preset: "aiep-coding-plan", Key: "fixture", Chat: "http://127.0.0.1:19999/v1", Models: []string{"glm-5.3-flash-zp", "glm-5.3-zp"}}
	file := appdir.Join(appdir.Cache(), "routing-catalog.json")
	write := func(first, second float64) {
		t.Helper()
		raw, _ := json.Marshal(map[string]any{"revision": "fixture", "expires_at": time.Now().Add(time.Hour), "models": []map[string]any{
			{"provider": p.ID, "model": "glm-5.3-flash", "currency": "PLAN_TOKENS", "coefficient": first, "score": first},
			{"provider": p.ID, "model": "glm-5.3", "currency": "PLAN_TOKENS", "coefficient": second, "score": second},
		}})
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, raw, 0600); err != nil {
			t.Fatal(err)
		}
		catalog.Reset()
	}
	write(1, 7)
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	g, err := AddTemplate(TemplateThrifty, "")
	if err != nil {
		t.Fatal(err)
	}
	check := func(want string) {
		t.Helper()
		for _, next := range Groups() {
			if next.ID == g.ID {
				if next.Members[0] != want {
					t.Fatalf("stale persisted template: %v, want %s", next.Members, want)
				}
				return
			}
		}
		t.Fatal("saved template missing")
	}
	check(p.ID + "/" + p.Models[0])
	write(7, 1)
	check(p.ID + "/" + p.Models[1])
	catalog.Reset()
	check(p.ID + "/" + p.Models[1])
}
