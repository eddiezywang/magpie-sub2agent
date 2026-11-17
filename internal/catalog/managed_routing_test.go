//go:build intranet

package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestManagedRoutingRefreshPreservesCacheAndExpiresPromotions(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	var good atomic.Bool
	good.Store(true)
	doc := managedRouting{Revision: "fixture", Expires: time.Now().Add(time.Hour), Models: []managedRate{{Provider: "sub2agent-workbuddy*", Model: "hy4free", Score: 0}, {Provider: "sub2agent-workbuddy*", Model: "glm-5.3-flash-maas", Score: 1}, {Provider: "sub2agent-tigcodingplan*", Model: "glm-*", Score: 1}, {Provider: "sub2agent-workbuddy*", Model: "expired", Score: 0, Until: time.Now().Add(-time.Hour)}}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !good.Load() {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(doc)
	}))
	defer srv.Close()
	old := managedRoutingURL
	managedRoutingURL = srv.URL
	t.Cleanup(func() { managedRoutingURL = old })
	if err := refreshManagedRouting(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, m := range []struct {
		p, m  string
		score float64
	}{{"sub2agent-workbuddy#account", "hy4free", 0}, {"sub2agent-workbuddy", "glm-5.3-flash-maas-fixture", 1}, {"sub2agent-tigcodingplan-2", "glm-5.2", 1}} {
		if score, ok := RoutingScore(m.p, m.m); !ok || score != m.score {
			t.Fatalf("missing managed rank: %+v", m)
		}
	}
	if _, ok := RoutingScore("sub2agent-workbuddy", "expired"); ok {
		t.Fatal("expired promotion used")
	}
	good.Store(false)
	if err := refreshManagedRouting(context.Background()); err == nil {
		t.Fatal("outage hidden")
	}
	if _, ok := RoutingScore("sub2agent-workbuddy", "hy4free"); !ok {
		t.Fatal("outage cleared last valid cache")
	}
	doc.Expires = time.Now().Add(-time.Hour)
	raw, _ := json.Marshal(doc)
	os.WriteFile(filepath.Clean(managedRoutingPath()), raw, 0600)
	if _, ok := RoutingScore("sub2agent-workbuddy", "hy4free"); ok {
		t.Fatal("expired catalog used")
	}
}

func TestRoutingBillingExactRuleAndExpiredOverride(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	zero, seven := 0.0, 7.0
	d := managedRouting{Revision: "points-v2", Expires: time.Now().Add(time.Hour), Models: []managedRate{
		{Provider: "wb*", Model: "glm-*", Score: zero, Currency: "POINTS", Coefficient: &zero},
		{Provider: "wb", Model: "glm-5-maas", Score: seven, Currency: "POINTS", Coefficient: &seven, Source: "MaaS"},
	}}
	write := func() {
		t.Helper()
		raw, _ := json.Marshal(d)
		os.MkdirAll(filepath.Dir(managedRoutingPath()), 0700)
		if err := os.WriteFile(managedRoutingPath(), raw, 0600); err != nil {
			t.Fatal(err)
		}
		Reset()
	}
	write()
	b := RoutingBillingOf("wb", "glm-5-maas-tenant")
	if b.State != "active" || b.Currency != "POINTS" || b.Coefficient == nil || *b.Coefficient != 7 || b.Pool != "" || b.Revision != "points-v2" {
		t.Fatalf("wrong billing: %+v", b)
	}
	d.Models[1].Until = time.Now().Add(-time.Hour)
	write()
	b = RoutingBillingOf("wb", "glm-5-maas-tenant")
	if b.State != "expired" || b.Coefficient != nil {
		t.Fatalf("expired rule became free wildcard: %+v", b)
	}
	if _, ok := RoutingScore("wb", "glm-5-maas-tenant"); ok {
		t.Fatal("expired score used")
	}
	if RoutingBillingOf("other", "glm-5").State != "unknown" {
		t.Fatal("unknown billing inferred")
	}
}

func TestManagedZhipuDeploymentRequiresExplicitRule(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	rate := creditRates{Input: 6.9, CacheRead: 1.7, Output: 24}
	one := 1.0
	d := managedRouting{Revision: "zhipu", Expires: time.Now().Add(time.Hour), Models: []managedRate{
		{Provider: "sub2agent-tigcodingplan*", Model: "glm-*", Score: 1, Currency: "PLAN_TOKENS", Coefficient: &one},
		{Provider: "sub2agent-tigcodingplan*", Model: "glm-5.3-zp", Deployment: "zp", Score: 6.9, Currency: "GLM_POINTS", CreditRates: &rate, Source: "Zhipu Coding Plan"},
	}}
	raw, _ := json.Marshal(d)
	os.MkdirAll(filepath.Dir(managedRoutingPath()), 0700)
	if err := os.WriteFile(managedRoutingPath(), raw, 0600); err != nil {
		t.Fatal(err)
	}
	Reset()
	for _, id := range []string{"glm-5.3-zp", "glm-5.3-zp-openai"} {
		b := RoutingBillingOf("sub2agent-tigcodingplan", id)
		if b.State != "active" || b.CreditRates == nil || b.CreditRates.Output != 24 || b.Coefficient != nil {
			t.Fatalf("%s: %+v", id, b)
		}
	}
	if b := RoutingBillingOf("sub2agent-tigcodingplan", "glm-5.3"); b.Coefficient == nil || *b.Coefficient != 1 {
		t.Fatalf("non-ZP changed: %+v", b)
	}
	if b := RoutingBillingOf("sub2agent-tigcodingplan", "glm-5.9-zp"); b.State != "unknown" {
		t.Fatalf("unknown ZP got a made-up rate: %+v", b)
	}
}

func TestManagedTIGChannelsStaySeparate(t *testing.T) {
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	tc, hs := 7.0, 4.5
	d := managedRouting{Revision: "tig", Expires: time.Now().Add(time.Hour), Models: []managedRate{
		{Provider: "sub2agent-tigcodingplan*", Model: "glm-5.3-tc", Deployment: "tc", Score: 1, Currency: "TC_POINTS", Coefficient: &tc},
		{Provider: "sub2agent-tigcodingplan*", Model: "glm-5.3-hs", Deployment: "hs", Score: 1, Currency: "VOLC_AFP", Coefficient: &hs}}}
	raw, _ := json.Marshal(d)
	os.MkdirAll(filepath.Dir(managedRoutingPath()), 0700)
	if err := os.WriteFile(managedRoutingPath(), raw, 0600); err != nil {
		t.Fatal(err)
	}
	Reset()
	for _, row := range []struct {
		id, currency string
		value        float64
	}{{"glm-5.3-openai-tc", "TC_POINTS", 7}, {"glm-5.3-tc-openai", "TC_POINTS", 7}, {"glm-5.3-openai-hs", "VOLC_AFP", 4.5}, {"glm-5.3-hs-openai", "VOLC_AFP", 4.5}} {
		b := RoutingBillingOf("sub2agent-tigcodingplan", row.id)
		if b.State != "active" || b.Currency != row.currency || b.Coefficient == nil || *b.Coefficient != row.value {
			t.Fatalf("%s: %+v", row.id, b)
		}
	}
	if b := RoutingBillingOf("sub2agent-tigcodingplan", "glm-5.3-zp"); b.State != "unknown" {
		t.Fatalf("channels mixed: %+v", b)
	}
}
