//go:build intranet

package gateway

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/yetone/magpie/internal/access"
	"github.com/yetone/magpie/internal/masking"
	"github.com/yetone/magpie/internal/settings"
)

func TestIntranetIgnoresInheritedMaskingPolicies(t *testing.T) {
	fresh(t)
	st := settings.Settings{Redact: true, RedactPersonal: true, RedactModel: true, RedactWords: []string{"sensitive-example"}}
	if err := settings.Save(st); err != nil {
		t.Fatal(err)
	}
	if masking.Wanted(st) || masking.ModelWanted(st) {
		t.Fatal("removed masking still enabled")
	}
	body := []byte(`{"messages":[{"role":"user","content":"sensitive-example"}]}`)
	for _, mode := range []string{"", access.RedactOn, access.RedactOff} {
		ctx := access.WithIdentity(context.Background(), access.Identity{Redact: mode})
		if redactionWantedFor(ctx) {
			t.Fatalf("inherited key policy %q enabled masking", mode)
		}
		w := httptest.NewRecorder()
		rw, got, done, err := redacted(ctx, w, body)
		if err != nil || rw != w || string(got) != string(body) {
			t.Fatalf("key %q blocked or changed request: %v %s", mode, err, got)
		}
		done()
		if got, _, err := maskedText(ctx, "sensitive-example"); err != nil || got != "sensitive-example" {
			t.Fatalf("text: %q %v", got, err)
		}
	}
	if !settings.Load().Redact {
		t.Fatal("imported configuration was rewritten")
	}
}
