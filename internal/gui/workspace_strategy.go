package gui

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/yetone/magpie/internal/agent"
	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/provider"
)

func workspaceStrategy(mux *http.ServeMux) {
	if !distribution.Internal {
		return
	}
	mux.HandleFunc("POST /api/workspace/strategy", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Agent, Kind, Expected string }
		if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
			fail(w, err)
			return
		}
		a, err := agent.Find(in.Agent)
		if err != nil {
			fail(w, err)
			return
		}
		f := a.Field("model")
		if !a.Wired() || f == nil {
			fail(w, errors.New("Connect an Agent to choose a routing group"))
			return
		}
		if f.Get() != in.Expected {
			fail(w, errors.New("Agent model changed; refresh and try again"))
			return
		}
		g, err := provider.EnsureTemplate(in.Kind)
		if err != nil {
			fail(w, err)
			return
		}
		ref := "group/" + g.ID
		value := ""
		for _, o := range a.Picks(*f, a.Values()) {
			if o.Ref == ref || o.Value == ref {
				value = o.Value
				break
			}
		}
		if value == "" {
			fail(w, errors.New("Routing group is not available to this Agent"))
			return
		}
		if _, _, ok := provider.FindGroup(ref); !ok {
			fail(w, errors.New("Routing group is no longer available"))
			return
		}
		if f.Get() != in.Expected {
			fail(w, errors.New("Agent model changed; refresh and try again"))
			return
		}
		if err := a.Pick(f.Key, value); err != nil {
			fail(w, err)
			return
		}
		s := state()
		if a.Notice != nil {
			s.Notice = a.Notice()
		}
		writeJSON(w, s)
	})
}

// Apply only to a first connection with no main-model preference at all.
func connectWithWorkspaceDefault(a *agent.Agent) (agent.Connection, error) {
	f := a.Field("model")
	useDefault := distribution.Internal && !a.Wired() && f != nil && f.Get() == "" && a.Native == nil
	if useDefault {
		if _, err := provider.MakeTemplate(provider.TemplateFlashFirst); err == nil {
			if _, err := provider.EnsureTemplate(provider.TemplateFlashFirst); err != nil {
				return agent.Connection{}, err
			}
		} else {
			useDefault = false
		}
	}
	c, err := a.ConnectHow()
	if err != nil || !useDefault {
		return c, err
	}
	for _, g := range provider.Groups() {
		if g.TemplateKind != provider.TemplateFlashFirst || g.Disabled {
			continue
		}
		ref := "group/" + g.ID
		for _, o := range a.Picks(*f, a.Values()) {
			if o.Ref == ref || o.Value == ref {
				return c, a.Pick(f.Key, o.Value)
			}
		}
	}
	return c, nil
}
