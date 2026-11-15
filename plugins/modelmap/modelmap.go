// Package modelmap provides offline model aliases in the internal distribution.
package modelmap

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/yetone/magpie/internal/gwmw"
	"github.com/yetone/magpie/internal/middleware"
	"github.com/yetone/magpie/internal/pluginrt"
)

//go:embed model-map.js
var source string

type Settings struct {
	Mapping          string `json:"mapping" title:"Model mappings (JSON)" description:"Map requested names to provider/model IDs. Example: {\"fast\":\"aiep-coding-plan/model-id\"}. Empty rules leave requests unchanged."`
	KeepUpstreamName bool   `json:"keepUpstreamName" title:"Keep upstream model names" description:"Return the actual model name instead of the requested alias in replies"`
}

func init() {
	pluginrt.Register(pluginrt.Manifest{
		ID: "modelmap", API: "^1", Name: "Model mapping", Sub: "Map model aliases locally before routing; no network or additional model requests",
		Requires: []string{"gateway"}, Essential: true, Settings: Settings{Mapping: "{}"}, RestartOnConfig: true,
		Apply: func(c *pluginrt.Ctx) error {
			rules, _ := c.Config["mapping"].(string)
			var mapping map[string]string
			if err := json.Unmarshal([]byte(rules), &mapping); err != nil || mapping == nil {
				return fmt.Errorf("model mappings must be a JSON object of names to model IDs")
			}
			for from, to := range mapping {
				if from == "" || to == "" {
					return fmt.Errorf("model mapping names and targets cannot be empty")
				}
			}
			keep, _ := c.Config["keepUpstreamName"].(bool)
			agent, err := middleware.Embedded("modelmap", source, map[string]any{"mapping": mapping, "keep_upstream_name": keep})
			if err != nil {
				return err
			}
			c.OnDispose(gwmw.Use(agent))
			return nil
		},
	})
}
