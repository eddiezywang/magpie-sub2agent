//go:build intranet

package provider

import "testing"

func TestZHTPresetRequestPaths(t *testing.T) {
	p, err := FromPreset("cib-zht-apikey")
	if err != nil {
		t.Fatal(err)
	}
	for protocol, want := range map[Protocol]string{
		Chat:      "http://10.32.33.46:11288/efllmas-agw/v1/chat/completions",
		Anthropic: "http://10.32.33.46:11288/efllmas-agw/anthropicproxy/v1/messages",
	} {
		got, _ := tiny(p, protocol, "fixture-model")
		if got != want {
			t.Fatalf("%s path = %s, want %s", protocol, got, want)
		}
	}
	if p.Icon != "cib-zht" {
		t.Fatal("ZHT logo not selected")
	}
}

func TestZHTKeepsCustomGatewaysAndKey(t *testing.T) {
	azureHome(t)
	p, err := FromPreset("cib-zht-apikey")
	if err != nil {
		t.Fatal(err)
	}
	p.Chat = "http://gateway.test/custom/v1"
	p.Anthropic = "http://gateway.test/custom/anthropic"
	p.Key = "fixture-custom-key"
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	saved, err := Find(p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Chat != p.Chat || saved.Anthropic != p.Anthropic || saved.Key != p.Key {
		t.Fatal("custom gateways or key were replaced by preset defaults")
	}
	for protocol, want := range map[Protocol]string{
		Chat: p.Chat + "/chat/completions", Anthropic: p.Anthropic + "/v1/messages",
	} {
		got, _ := tiny(*saved, protocol, "fixture-model")
		if got != want {
			t.Fatalf("custom gateway request path: %s", got)
		}
	}
}
