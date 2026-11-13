// Package accounting registers intranet reporting controls in the existing
// built-in plugin settings form. It adds no public analytics or body capture.
package accounting

import (
	"github.com/yetone/magpie/internal/accounting"
	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/pluginrt"
	"github.com/yetone/magpie/internal/usage"
)

func init() {
	pluginrt.Register(pluginrt.Manifest{
		ID: "accounting", API: "^1", Name: "Telemetry reporting", Sub: "Report application activity and usage statistics without conversation content",
		// An empty schema rejects retired per-plane switches and endpoint
		// overrides, including stale plugins.yml values, before composing UI config.
		Requires: []string{"gateway"}, Essential: true, Settings: struct{}{}, RestartOnConfig: true, MigrateRow: migrateRow,
		Apply: func(c *pluginrt.Ctx) error {
			r, err := accounting.New(appdir.Config(), accounting.Defaults().WithEnv(), gateway.Version)
			if err != nil {
				return err
			}
			c.OnDispose(usage.Observe(r))
			return nil
		},
	})
}

func migrateRow(r pluginrt.Row) pluginrt.Row {
	// Preserve the old global opt-out. The per-request reporting switch was a
	// rollout detail; it no longer selects a different reporting mode.
	if enabled, ok := r.Config["legacyEnabled"].(bool); ok && !enabled {
		off := false
		r.Enabled = &off
	}
	r.Config = nil
	return r
}
