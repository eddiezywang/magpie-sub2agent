//go:build intranet

package provider

import (
	"context"
	"testing"

	"github.com/yetone/magpie/internal/plugin"
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
	for _, id := range []string{"sub2agent-codebuddy", "sub2agent-trae"} {
		if _, err := plugin.Authorize(context.Background(), id, 0, nil, plugin.NewAccount); err == nil {
			t.Fatalf("plugin bypass for %s", id)
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
