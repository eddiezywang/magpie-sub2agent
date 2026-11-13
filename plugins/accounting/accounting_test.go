package accounting

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	core "github.com/yetone/magpie/internal/accounting"
	"github.com/yetone/magpie/internal/pluginrt"
	"github.com/yetone/magpie/internal/testenv"
)

func TestMain(m *testing.M) { testenv.Main(m) }

func TestReportingHasOnlyItsPluginSwitchAndFixedDestinations(t *testing.T) {
	var manifest pluginrt.Manifest
	for _, m := range pluginrt.Registered() {
		if m.ID == "accounting" {
			manifest = m
		}
	}
	if manifest.Name != "Telemetry reporting" || manifest.Schema() == nil || len(manifest.Schema().Properties) != 0 || len(manifest.Defaults) != 0 {
		t.Fatal("reporting exposed internal options")
	}
	old := map[string]any{"legacyEnabled": true, "usageEnabled": false, "legacyURL": "http://private.invalid/events", "usageURL": "http://private.invalid/usage"}
	rows := pluginrt.Compose([]pluginrt.Manifest{manifest}, pluginrt.File{Plugins: []pluginrt.Row{{ID: "accounting", Config: old}}})
	data, _ := json.Marshal(rows)
	if len(rows) != 1 || !rows[0].Enabled || rows[0].Config != nil || strings.Contains(string(data), "private.invalid") || len(old) != 4 {
		t.Fatalf("retired settings leaked or input mutated: %s", data)
	}
	defaults := core.Defaults()
	if !defaults.LegacyEnabled || !defaults.UsageEnabled {
		t.Fatal("one reporting mode did not enable both streams")
	}
	t.Setenv("CB_PROXY_TELEMETRY_URL", "http://private.invalid/override")
	if defaults.WithEnv().LegacyURL != defaults.LegacyURL {
		t.Fatal("environment replaced the managed endpoint")
	}
}

func TestReportingMigrationPreservesOptOutAndAllowsReenable(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("MAGPIE_PORTABLE", "")
	if err := os.MkdirAll(filepath.Dir(pluginrt.Path()), 0700); err != nil {
		t.Fatal(err)
	}
	legacy := "preset: all\nplugins:\n  - id: accounting\n    enabled: true\n    config:\n      legacyEnabled: false\n      usageEnabled: false\n      legacyURL: http://private.invalid/events\n"
	if err := os.WriteFile(pluginrt.Path(), []byte(legacy), 0600); err != nil {
		t.Fatal(err)
	}
	f, _, err := pluginrt.Load()
	if err != nil || f.Plugins[0].Enabled == nil || *f.Plugins[0].Enabled || f.Plugins[0].Config != nil {
		t.Fatal("old reporting opt-out or obsolete settings were not migrated")
	}
	if err = pluginrt.Set("accounting", true); err != nil {
		t.Fatal(err)
	}
	f, _, err = pluginrt.Load()
	if err != nil || !*f.Plugins[0].Enabled {
		t.Fatal("migration overrode the user's new switch choice")
	}
	data, _ := os.ReadFile(pluginrt.Path())
	if strings.Contains(string(data), "legacyURL") || strings.Contains(string(data), "private.invalid") {
		t.Fatal("retired endpoint survived a user settings write")
	}
	if err = pluginrt.SetConfig("accounting", map[string]any{"usageURL": "http://private.invalid"}); err == nil {
		t.Fatal("managed destination could be replaced through the API")
	}
}
