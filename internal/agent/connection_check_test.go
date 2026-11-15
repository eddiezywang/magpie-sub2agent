package agent

import (
	"os"
	"path/filepath"
	"testing"
)

func TestConnectionCheckSelectedLegacyCodex(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.toml")
	const config = "model_provider = \"sub2agent\"\nmodel = \"old-model\"\n[model_providers.sub2agent]\nbase_url = \"http://localhost:8989/v1/\"\n"
	if err := os.WriteFile(path, []byte(config), 0600); err != nil {
		t.Fatal(err)
	}
	a := &Agent{ID: "codex", Path: path}
	got := CheckConnection(a, "http://127.0.0.1:8989")
	if got.Status != "configured" || got.Managed {
		t.Fatalf("legacy connection: %+v", got)
	}
	raw, _ := os.ReadFile(path)
	if string(raw) != config {
		t.Fatal("status check rewrote config")
	}
	if err := os.WriteFile(path, []byte("model_provider = \"openai\"\n"+config[len("model_provider = \"sub2agent\"\n"):]), 0600); err != nil {
		t.Fatal(err)
	}
	if got := CheckConnection(a, "http://127.0.0.1:8989"); got.Status != "disconnected" {
		t.Fatalf("unused table connected: %+v", got)
	}
}

func TestConnectionCheckGatewayBoundaries(t *testing.T) {
	for _, base := range []string{"http://remote.test:8989/v1", "http://127.0.0.1:8988/v1", "http://127.0.0.1:8989/other", "http://127.0.0.1:8989/v1?key=x", ""} {
		if sameLocalGateway(base, "http://127.0.0.1:8989") {
			t.Fatalf("accepted unrelated gateway %q", base)
		}
	}
}
