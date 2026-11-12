// Package accounting registers intranet reporting controls in the existing
// built-in plugin settings form. It adds no public analytics or body capture.
package accounting

import (
	"encoding/json"

	"github.com/yetone/magpie/internal/accounting"
	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/gateway"
	"github.com/yetone/magpie/internal/pluginrt"
	"github.com/yetone/magpie/internal/usage"
)

func init() {
	pluginrt.Register(pluginrt.Manifest{
		ID: "accounting", API: "^1", Name: "Usage reporting", Sub: "Keep legacy telemetry and send numeric usage to the intranet billing service without conversation content",
		Requires: []string{"gateway"}, Essential: true, Settings: accounting.Defaults(), RestartOnConfig: true,
		Apply: func(c *pluginrt.Ctx) error {
			options := accounting.Defaults()
			data, err := json.Marshal(c.Config)
			if err != nil {
				return err
			}
			if err = json.Unmarshal(data, &options); err != nil {
				return err
			}
			r, err := accounting.New(appdir.Config(), options.WithEnv(), gateway.Version)
			if err != nil {
				return err
			}
			c.OnDispose(usage.Observe(r))
			return nil
		},
	})
}
