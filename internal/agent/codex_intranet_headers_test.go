//go:build intranet

package agent

import "testing"

func TestInternalCodexAddsNoActorHeader(t *testing.T) {
	for _, field := range codexProviderTable("http://127.0.0.1:8989/v1", "fixture") {
		if field.Path == "http_headers" {
			t.Fatal("internal connection injected actor headers")
		}
	}
}
