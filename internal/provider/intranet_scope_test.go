//go:build intranet

package provider

import (
	"testing"
)

func TestIntranetProviderScope(t *testing.T) {
	azureHome(t)
	for _, id := range []string{"claude", "codex", "sub2agent-codebuddy", "sub2agent-trae"} {
		if _, err := StartSignIn(id); err == nil {
			t.Fatalf("disabled source %s started signing in", id)
		}
		if err := Save(Provider{ID: id, Chat: "http://fixture.invalid/v1", Key: "fixture"}); err == nil {
			t.Fatalf("disabled source %s was saved", id)
		}
	}
	for _, id := range []string{"anthropic", "openai"} {
		if _, err := FromPreset(id); err == nil {
			t.Fatalf("disabled preset %s was offered", id)
		}
	}
	custom := Provider{ID: "custom-fixture", Name: "Custom fixture", Chat: "http://fixture.invalid/v1", Key: "fixture"}
	if err := Save(custom); err != nil {
		t.Fatal(err)
	}
	if _, err := Find(custom.ID); err != nil {
		t.Fatal("custom source unavailable", err)
	}
}

func TestIntranetRemoteSub2Agent(t *testing.T) {
	azureHome(t)
	p, err := FromPreset(RemoteMagpiePreset)
	if err != nil {
		t.Fatal(err)
	}
	if p.Name != "Remote sub2agent" || !p.IsRemoteMagpie() {
		t.Fatalf("remote preset: %+v", p)
	}
	found := false
	for _, pr := range Presets() {
		if pr.ID == RemoteMagpiePreset && pr.Name == p.Name {
			found = true
		}
	}
	if !found {
		t.Fatal("remote sub2agent missing from presets")
	}
	p.Chat = "http://192.168.1.2:8989"
	p.Key = "fixture-key"
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	saved, err := Find(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !saved.IsRemoteMagpie() || saved.Chat != "http://192.168.1.2:8989/v1" || saved.Anthropic != "http://192.168.1.2:8989" {
		t.Fatalf("saved remote gateway: %+v", saved)
	}
}

func TestNativeAPIPresetsFollowPluginSwitch(t *testing.T) {
	azureHome(t)
	previous := nativeAPIEnabled
	on := false
	nativeAPIEnabled = func() bool { return on }
	t.Cleanup(func() { nativeAPIEnabled = previous })
	if _, err := FromPreset("openai"); err == nil {
		t.Fatal("disabled preset offered")
	}
	on = true
	p, err := FromPreset("openai")
	if err != nil {
		t.Fatal(err)
	}
	p.Key = "fixture-key"
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	if _, err := Find(p.ID); err != nil {
		t.Fatal(err)
	}
	on = false
	if _, err := Find(p.ID); err == nil {
		t.Fatal("disabled preset still served")
	}
	on = true
	kept, err := Find(p.ID)
	if err != nil || kept.Key != "fixture-key" {
		t.Fatalf("saved provider not restored: %+v %v", kept, err)
	}
}
func TestOptionalNativePresetsAreIndependent(t *testing.T) {
	azureHome(t)
	old := nativePresetEnabled
	enabled := map[string]bool{}
	nativePresetEnabled = func(id string) bool { return enabled[id] }
	t.Cleanup(func() { nativePresetEnabled = old })
	for _, id := range []string{"glm-coding-plan", "deepseek-api"} {
		if _, err := FromPreset(id); err == nil {
			t.Fatalf("%s offered while disabled", id)
		}
	}
	enabled["glm-coding-plan"] = true
	glm, err := FromPreset("glm-coding-plan")
	if err != nil {
		t.Fatal(err)
	}
	if glm.Chat != "https://open.bigmodel.cn/api/coding/paas/v4" || glm.Key != "" {
		t.Fatalf("GLM default: %+v", glm)
	}
	if _, err := FromPreset("deepseek-api"); err == nil {
		t.Fatal("DeepSeek enabled by GLM switch")
	}
	glm.Key = "fixture-key"
	if err := Save(glm); err != nil {
		t.Fatal(err)
	}
	enabled["glm-coding-plan"] = false
	if _, err := Find(glm.ID); err == nil {
		t.Fatal("disabled GLM still served")
	}
	enabled["glm-coding-plan"] = true
	if got, err := Find(glm.ID); err != nil || got.Key != "fixture-key" {
		t.Fatalf("GLM restore: %+v %v", got, err)
	}
	enabled["deepseek-api"] = true
	deep, err := FromPreset("deepseek-api")
	if err != nil || deep.Chat != "https://api.deepseek.com/v1" || deep.Key != "" {
		t.Fatalf("DeepSeek: %+v %v", deep, err)
	}
}
