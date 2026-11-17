//go:build intranet

package accounting

import (
	"github.com/yetone/magpie/internal/usage"
	"testing"
	"time"
)

func TestSummaryManagedRulesMatchActualDeploymentIDs(t *testing.T) {
	rules := AggregationRules{Revision: "fixture-policy", Models: []ModelRule{{Provider: "sub2agent-tigcodingplan*", Model: "glm-5.3-flash", Above: []int64{}}}}
	if err := rules.Validate(); err != nil {
		t.Fatal(err)
	}
	var b minuteBuffer
	at := time.Date(2026, 11, 13, 8, 0, 0, 0, time.UTC)
	r := usage.Record{Provider: "sub2agent-tigcodingplan-2", Model: "glm-5.3-flash-zp", Agent: "codex", Input: 100, Output: 20}
	if err := b.Add(r, at, &rules); err != nil {
		t.Fatal(err)
	}
	for key := range b.groups {
		if key.ContextTier != "base" || key.Model != r.Model {
			t.Fatal("rule failed or upstream model identity was changed")
		}
	}
	if summaryRuleMatch("glm-5.3-flash", "glm-5.3-flash-lite-zp", true) {
		t.Fatal("variant matched shorter prefix")
	}
}

func TestTIGSummaryKeepsRequestedChannelWhenServedModelDiffers(t *testing.T) {
	at := time.Date(2026, 11, 13, 8, 0, 0, 0, time.UTC)
	var b minuteBuffer
	for _, model := range []string{"glm-5.3-zp", "glm-5.3-tc"} {
		if err := b.Add(usage.Record{Provider: "aiep-coding-plan", Model: model, Served: "glm-5.3", Input: 100}, at, nil); err != nil {
			t.Fatal(err)
		}
	}
	if len(b.groups) != 2 {
		t.Fatalf("channels collapsed into %d groups", len(b.groups))
	}
	for k := range b.groups {
		if k.Model != "glm-5.3" || k.TIGRequestModel == "" || k.ModelSource != "served" {
			t.Fatalf("lost model identity: %+v", k)
		}
	}
}
