//go:build intranet

package agent

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/yetone/magpie/internal/catalog"
	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/provider"
)

func TestPiZHTInheritsOfficialReasoningAndJoinsFlashTemplate(t *testing.T) {
	home := syncHome(t)
	if err := os.WriteFile(catalog.CachePath(), []byte(`{
	  "deepseek":{"models":{"deepseek-v4-flash":{"id":"deepseek-v4-flash","reasoning":true,
	    "reasoning_options":[{"type":"effort","values":["low","high","max"]}]}}},
	  "zai":{"models":{"glm-5.3-flash":{"id":"glm-5.3-flash","reasoning":true}}}
	}`), 0o644); err != nil {
		t.Fatal(err)
	}
	catalog.Reset()
	t.Cleanup(catalog.Reset)
	tig := provider.Provider{ID: "aiep-coding-plan", Preset: "aiep-coding-plan", Key: "fixture",
		Chat: "http://127.0.0.1:1/v1", ListOff: true, Models: []string{"glm-5.3-flash-zp"}}
	if err := provider.Save(tig); err != nil {
		t.Fatal(err)
	}
	group, err := provider.EnsureTemplate("flash-first")
	if err != nil {
		t.Fatal(err)
	}
	const rawModel = "deepseek-v4-flash-0731-aliyun"
	zht := provider.Provider{ID: "cib-zht-apikey", Preset: "cib-zht-apikey", Key: "fixture",
		Chat: "http://127.0.0.1:1/v1", ListOff: true, Models: []string{rawModel}}
	if err := provider.Save(zht); err != nil {
		t.Fatal(err)
	}
	id := zht.ID + "/" + rawModel
	matched := slices.IndexFunc(provider.Groups(), func(g provider.Group) bool {
		return g.ID == group.ID && slices.Contains(g.Members, id)
	})
	if matched < 0 {
		t.Fatal("saved Flash first template did not include the new provider")
	}
	const sameGLM = "glm-5.3-flash-aliyun"
	zht.Models = append(zht.Models, sameGLM)
	if err := provider.Save(zht); err != nil {
		t.Fatal(err)
	}
	matched = slices.IndexFunc(provider.Groups(), func(g provider.Group) bool {
		return g.ID == provider.AutoGroupID("glm-5.3-flash") && slices.Contains(g.Members, zht.ID+"/"+sameGLM) &&
			!slices.Contains(g.Members, id)
	})
	if matched < 0 {
		t.Fatal("automatic GLM group did not distinguish the same GLM deployment from DeepSeek Flash")
	}
	if err := pi(home).Field("model").Set("magpie/" + id); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(home, ".pi", "agent", "models.json")
	if err := edit.SetJSON(path, edit.KV{Path: "providers.magpie.apiKey", Value: gateway.Token}); err != nil {
		t.Fatal(err)
	}
	if err := pi(home).Sync(); err != nil {
		t.Fatal(err)
	}
	if key, _ := edit.GetJSON(path, "providers.magpie.apiKey"); key != gateway.TokenFor("pi") {
		t.Fatal("Pi sync did not replace the old gateway placeholder with its named token")
	}
	var file struct {
		Providers map[string]struct{ Models []map[string]any }
	}
	if err := json.Unmarshal([]byte(readFile(path)), &file); err != nil {
		t.Fatal(err)
	}
	models := file.Providers["magpie"].Models
	i := slices.IndexFunc(models, func(m map[string]any) bool { return m["id"] == id })
	if i < 0 || models[i]["reasoning"] != true || !slices.Equal(piSupported(models[i]), []string{"low", "high", "max"}) {
		t.Fatalf("generated Pi model did not keep the official reasoning capability: index=%d", i)
	}
}
