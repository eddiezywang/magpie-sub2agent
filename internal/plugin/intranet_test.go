//go:build intranet

package plugin

import (
	"context"
	"github.com/yetone/magpie/internal/distribution"
	"testing"
)

func TestIntranetRegistryCannotBeOverridden(t *testing.T) {
	t.Setenv("NPM_CONFIG_REGISTRY", "https://public.invalid")
	t.Setenv("BUN_CONFIG_REGISTRY", "https://public.invalid")
	if got := Registry().URL; got != distribution.Registry {
		t.Fatal(got)
	}
	if _, err := SetRegistry("https://public.invalid"); err == nil {
		t.Fatal("registry changed")
	}
	if got, _, _ := npmBase("@scope/package"); got != distribution.Registry {
		t.Fatal(got)
	}
}

func TestIntranetDoesNotInstallNetworkPlugins(t *testing.T) {
	if _, err := AddExact(context.Background(), "github:someone/plugin"); err == nil {
		t.Fatal("git install allowed")
	}
	if err := install(context.Background(), "some-package@1.0.0"); err == nil {
		t.Fatal("network install allowed")
	}
}
