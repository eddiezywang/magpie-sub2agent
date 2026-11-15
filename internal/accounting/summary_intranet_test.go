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
