package middleware

import (
	"encoding/json"
	"github.com/MoeForge/moejs"
	"github.com/yetone/magpie/internal/gwmw"
	"github.com/yetone/magpie/internal/plugin"
)

// Embedded compiles an immutable built-in using the same request, response and
// stream engine as marketplace middleware, without installing a local package.
func Embedded(name, source string, options map[string]any) (gwmw.Agent, error) {
	mod, err := moejs.Compile(name, source)
	if err != nil {
		return nil, err
	}
	m, err := compileModule(plugin.Entry{Spec: name, Options: options}, mod)
	if err != nil {
		return nil, err
	}
	return embedded{&set{list: []*mw{m}, hooked: true}}, nil
}

type embedded struct{ set *set }

func (a embedded) Begin(info gwmw.Info) gwmw.Run {
	b, _ := json.Marshal(info)
	return &Run{set: a.set, info: b, insts: make([]*inst, len(a.set.list)), ctxs: make([]moejs.Value, len(a.set.list))}
}
