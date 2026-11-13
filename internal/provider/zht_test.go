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
