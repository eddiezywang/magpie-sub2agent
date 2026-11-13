//go:build intranet

package catalog

import (
	"strings"
	"testing"
)

func TestInternalDeploymentSuffixesKeepModelCapabilities(t *testing.T) {
	writeCatalog(t, `{"zhipuai":{"models":{"glm-5.3-flash":{"id":"glm-5.3-flash","modalities":{"input":["text","image"],"output":["text"]},"limit":{"context":200000,"output":65536},"cost":{"input":1,"output":2}}}}}`)
	for _, id := range []string{"glm-5.3-flash-zp", "glm-5.3-flash-zp-openai", "glm-5.3-flash-maas-fixture-user", "sub2agent-tigcodingplan/glm-5.3-flash-zp"} {
		if ContextOf(id) != 200000 || !SeesImages(id) {
			t.Errorf("capabilities missing for %s", id)
		}
		if SameModel(id) != SameModel("glm-5.3-flash") {
			t.Errorf("wrong family identity %s", id)
		}
		if FamilyOf(id[strings.LastIndexByte(id, '/')+1:]).Name != FamilyOf("glm-5.3-flash").Name {
			t.Errorf("wrong version family %s", id)
		}
		if p, ok := PricedBy([]string{"zhipuai"}, id); !ok || p.Input != 1 {
			t.Errorf("price lookup failed for %s", id)
		}
		if DrawsID(id) {
			t.Errorf("text model falsely advertised as image generation: %s", id)
		}
	}
	for _, id := range []string{"glm-5.3-flash-extra", "glm-5.3-flash-lite-zp", "glm-5.3-flash-maas-invalid/tag", "other-model-zp"} {
		if ContextOf(id) != 0 {
			t.Errorf("invented alias %s: deployment=%s same=%s context=%d", id, DeploymentModel(id), SameModel(id), ContextOf(id))
		}
	}
}

func TestInternalDeploymentSuffixesPreserveExplicitVariant(t *testing.T) {
	writeCatalog(t, `{"zhipuai":{"models":{"glm-5.3-flash":{"id":"glm-5.3-flash","limit":{"context":200000},"cost":{"input":1}},"glm-5.3-flash-zp":{"id":"glm-5.3-flash-zp","limit":{"context":64000},"cost":{"input":3}}}}}`)
	if ContextOf("glm-5.3-flash-zp") != 64000 {
		t.Fatal("explicit variant capabilities overwritten")
	}
	if p, ok := PricedBy([]string{"zhipuai"}, "glm-5.3-flash-zp"); !ok || p.Input != 3 {
		t.Fatal("explicit variant price overwritten")
	}
}
