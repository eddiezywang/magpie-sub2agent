//go:build intranet

package provider

import (
	"slices"
	"testing"
)

func TestInternalRoutingTemplateSet(t *testing.T) {
	if !slices.Equal(availableTemplateKinds(), []string{TemplatePlan, TemplateSmart, TemplateThrifty, TemplateSteady}) {
		t.Fatal("internal routing templates differ from the four supported choices")
	}
	if (Provider{Preset: "aiep-coding-plan"}).BillingKind() != BillingPlan {
		t.Fatal("TIG Coding Plan not classified as a plan")
	}
}
