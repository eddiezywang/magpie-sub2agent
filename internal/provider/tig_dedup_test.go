//go:build intranet

package provider

import (
	"github.com/yetone/magpie/internal/catalog"
	"slices"
	"testing"
)

func TestTIGDefaultDedupKeepsExplicitModelsAndChannels(t *testing.T) {
	p := Provider{ID: "sub2agent-tigcodingplan", Preset: "aiep-coding-plan"}
	models := []catalog.Model{{ID: "glm-5.3-openai-zp"}, {ID: "glm-5.3-zp"}, {ID: "glm-5.3-zp-openai"}, {ID: "glm-5.3-hs"}, {ID: "glm-5.3-tc"}}
	ids := func(ms []catalog.Model) []string {
		r := []string{}
		for _, m := range ms {
			r = append(r, m.ID)
		}
		return r
	}
	if got := ids(p.ExposedOf(models)); !slices.Equal(got, []string{"glm-5.3-zp", "glm-5.3-hs", "glm-5.3-tc"}) {
		t.Fatalf("defaults %v", got)
	}
	p.Models = []string{"glm-5.3-openai-zp"}
	if got := ids(p.ExposedOf(models)); !slices.Equal(got, p.Models) {
		t.Fatalf("explicit selection lost: %v", got)
	}
	if len(models) != 5 {
		t.Fatal("available list changed")
	}
}
