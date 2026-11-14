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
