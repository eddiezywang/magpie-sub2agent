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

func TestInternalDeploymentUsesLongestOfficialPrefix(t *testing.T) {
	writeCatalog(t, `{"deepseek":{"models":{"deepseek-v4-flash":{"id":"deepseek-v4-flash","limit":{"context":200000},"reasoning":true,"reasoning_options":[{"type":"effort","values":["low","high","max"]}]},"deepseek-v4-flash-0731":{"id":"deepseek-v4-flash-0731","limit":{"context":300000},"reasoning":true,"reasoning_options":[{"type":"effort","values":["high","max"]}]}}}}`)
	const id = "cib-zht-apikey/DeepSeek-V4-Flash-0731-AliYun"
	if Spelling(id) != "deepseek-v4-flash-0731" || !Thinks(id) || strings.Join(EffortsOf(id), ",") != "high,max" {
		t.Fatalf("inherited wrong model capabilities: %q %v %v", Spelling(id), Thinks(id), EffortsOf(id))
	}
	if !Thinks("deepseek-v4-flashier-aliyun") {
		t.Fatal("arbitrary suffix did not retain the model capability")
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

func TestInternalGLM53DeploymentKeepsZhipuIdentity(t *testing.T) {
	writeCatalog(t, `{"zhipuai":{"models":{"glm-5.3":{"id":"glm-5.3","name":"GLM-5.3","modalities":{"input":["text","image"]},"limit":{"context":204800,"output":65536},"cost":{"input":4,"output":8},"reasoning_options":[{"type":"effort","values":["low","high","max"]}]},"glm-5.3-flash":{"id":"glm-5.3-flash","limit":{"context":1024000},"cost":{"input":1,"output":2}}}}}`)
	for _, id := range []string{"glm-5.3-zp", "glm-5.3-zp-openai", "glm-5.3-openai-zp", "glm-5.3-tc", "glm-5.3-openai-tc", "glm-5.3-hs", "glm-5.3-hs-openai", "tig/glm-5.3-zp", "glm-5.3-maas-user"} {
		if NameOf(id) != "GLM-5.3" || Spelling(id) != "glm-5.3" {
			t.Errorf("canonical name missing for %s: name=%q spelling=%q", id, NameOf(id), Spelling(id))
		}
		if SameModel(id) != SameModel("glm-5.3") || SameModel(id) == SameModel("glm-5.3-flash") {
			t.Errorf("identity lost for %s", id)
		}
		if ContextOf(id) != 204800 || !SeesImages(id) || OutputOf(id) != 65536 {
			t.Errorf("capabilities lost for %s: context=%d output=%d", id, ContextOf(id), OutputOf(id))
		}
		if p, ok := PricedBy([]string{"zhipuai"}, id); !ok || p.Input != 4 {
			t.Errorf("wrong model price for %s: %+v %v", id, p, ok)
		}
		if got := EffortsOf(id); len(got) != 3 || got[0] != "low" || got[2] != "max" {
			t.Errorf("reasoning levels lost for %s: %v", id, got)
		}
	}
}
