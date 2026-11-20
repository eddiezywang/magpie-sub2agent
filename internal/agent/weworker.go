package agent

// WeWorker (github.com/WeWorker/WeWorker, the desktop app) is an Electron
// site-automation agent whose engine is a Claude Code it drives over
// Anthropic Messages: buildConfiguredModelEnv (its backend-ts agent.ts)
// starts that Claude on ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN (or
// ANTHROPIC_API_KEY) taken from the provider its settings name. Its
// settings live in one settings.json under ~/.weworker (config.ts
// CONFIG_DIR, no variable, no WSL), and the provider "custom" is the one
// whose address, key and model are the user's:
//
//	{"active_provider":"custom","base_url_custom":"<gateway>",
//	 "api_key_custom":"magpie-weworker","model_custom":"<model>",
//	 "models_url_custom":"<gateway>/v1/models"}
//
// Requests then go to <base_url_custom>/v1/messages with Authorization
// Bearer (custom_auth_type auth_token, its default), which the gateway
// takes, and its own model picker lists the gateway's /v1/models
// (models_url_custom is a full URL: before models_url_is_full_custom
// existed every explicit catalog URL was one). The other slots are the
// user's own: anthropic, glm and deepseek each hold their model under
// model_<provider>, and the model field switches among them and magpie's.
//
// A key magpie writes in plaintext is read as is and encrypted into the
// file's _encrypted blob by WeWorker's next save (settings-secrets.ts,
// secret-store.ts: the plaintext wins on load), so Check takes the key
// from either place. WeWorker holds its settings in memory and writes the
// file whole on any change of its own, so magpie's writes reach it only
// after it is opened again, and what the user had in the custom slot
// before magpie's first write is stashed under weworker.own.*, since a
// whole-file save since would defeat the byte-for-byte restore.

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/yetone/magpie/internal/edit"
)

var noticeWeworker = newNotice("WeWorker reads its settings when it opens — restart an open WeWorker to use this.")

// weworkerKeys are settings.json's keys magpie's wiring writes, and the
// custom slot's own, which are stashed before magpie's first write.
var weworkerKeys = []string{"active_provider", "base_url_custom", "api_key_custom", "model_custom", "models_url_custom", "weworker_protocol_custom"}

// weworkerOwn is the stash key holding what the user had in the custom
// slot before magpie wrote it, as one JSON object.
const weworkerOwn = "weworker.own"

func weworker(home string) *Agent {
	dir := filepath.Join(home, ".weworker")
	path := filepath.Join(dir, "settings.json")
	get := func(k string) (string, bool) { return edit.GetJSON(path, k) }
	set := func(kvs ...edit.KV) error { return edit.SetJSON(path, kvs...) }
	// gw and key read fresh at every write, as the gateway's address may
	// have moved since the agent was built (a port move, Rewire)
	gw := func() string { return GatewayURL() }
	key := func() string { return agentKeyAt("weworker", gw()) }
	before := beforeMagpie{"weworker.before.absent", []string{path}}
	// wired says the custom slot is magpie's, exactly as Set wrote it
	wired := func() bool {
		if p, _ := get("active_provider"); p != "custom" {
			return false
		}
		u, ok := get("base_url_custom")
		return ok && u == gw()
	}
	// wiredBy says magpie owns the wiring now: an applied record with the
	// field it set, gone when Disconnect forgets the set-up. The custom
	// slot is shared with the user's own endpoint, so drift is drift only
	// where magpie set it up — and Get reads the pick as magpie's by this
	// record, not by the address in the file, which drift may have moved
	// away (Reapply re-applies what Get still reads as magpie's).
	wiredBy := func() bool {
		rec := appliedOf("weworker")
		return rec.Kept || rec.Fields["model"] != ""
	}
	return atomic(&Agent{
		ID: "weworker", Name: "WeWorker", Icon: "weworker-color",
		Dir: dir, Path: path, Spelled: prefixed,
		Restore: before.restore,
		Check: func() string {
			if !wiredBy() {
				return "" // never wired, or disconnected: the slot is theirs
			}
			if p, _ := get("active_provider"); p != "custom" {
				return "" // switched to one of their providers
			}
			u, _ := get("base_url_custom")
			if u != gw() {
				if reachesMagpie(u, gw()) {
					return "" // magpie through a proxy of theirs
				}
				return whatsOff("WeWorker", path, "base_url_custom", u, gw())
			}
			// the key magpie wrote in plaintext may have been moved into
			// the file's encrypted blob by WeWorker's own save; one in
			// neither place is gone
			if k, ok := get("api_key_custom"); !ok || k == "" {
				if e, ok := get("_encrypted.fields.api_key_custom"); !ok || e == "" {
					return whatsOff("WeWorker", path, "api_key_custom", "", key())
				}
			}
			return ""
		},
		Notice: func() string {
			if wired() && Running(`(?i)(^|/)weworker( |$)`) {
				return noticeWeworker.String()
			}
			return ""
		},
		Fields: []Field{
			{
				// the active provider and its model, as provider/model
				Key: "model", Label: "model",
				Get: func() string {
					p, _ := get("active_provider")
					var m string
					switch p {
					case "custom":
						m, _ = get("model_custom")
						// magpie's wiring reads the way the picker spells it,
						// drift included: by the address (a fresh write), the
						// key (the address drifts first), or magpie's applied
						// record (the key has since been encrypted into the
						// file's blob by WeWorker's own save). The user's own
						// endpoint reads as the slot it is.
						if m != "" {
							u, _ := get("base_url_custom")
							k, _ := get("api_key_custom")
							if u == gw() || keyHolds(k, key()) || wiredBy() {
								return magpieID + "/" + m
							}
						}
					case "anthropic":
						m, _ = get("model_anthropic")
					case "glm":
						m, _ = get("model_glm")
					case "deepseek":
						m, _ = get("model_deepseek")
					default:
						return ""
					}
					if m == "" {
						return ""
					}
					return p + "/" + m
				},
				Set: func(v string) error {
					if v == "" {
						return weworkerOff(path, get, set)
					}
					p, m, ok := strings.Cut(v, "/")
					if !ok || p == "" || m == "" {
						return fmt.Errorf("expected provider/model, got %q", v)
					}
					switch p {
					case magpieID:
						if !wiredBy() {
							before.take()
							weworkerStashOwn(get)
						}
						kvs := []edit.KV{
							{Path: "active_provider", Value: "custom"},
							{Path: "base_url_custom", Value: gw()},
							{Path: "api_key_custom", Value: key()},
							{Path: "model_custom", Value: m},
							{Path: "models_url_custom", Value: gw() + "/v1/models"},
						}
						// the slot runs Anthropic Messages here; a protocol
						// the user set to an OpenAI one moves, old stashed
						if w, has := get("weworker_protocol_custom"); has && w != "anthropic_messages" {
							kvs = append(kvs, edit.KV{Path: "weworker_protocol_custom", Value: "anthropic_messages"})
						}
						return set(kvs...)
					case "custom":
						// the slot on the user's own endpoint: the model is
						// theirs to name, magpie's address and key in it are
						// untouched here
						return set(edit.KV{Path: "active_provider", Value: p}, edit.KV{Path: "model_custom", Value: m})
					case "anthropic", "glm", "deepseek":
						return set(edit.KV{Path: "active_provider", Value: p}, edit.KV{Path: "model_" + p, Value: m})
					case "builtin":
						// the build's own model, named by no settings key
						return set(edit.KV{Path: "active_provider", Value: p})
					}
					return fmt.Errorf("%s isn't a provider WeWorker's row can switch to", p)
				},
				Options: func(cur map[string]string) []Option {
					return withVia(weworkerOwnModels(path, cur["model"]), "weworker", magpieID+"/")
				},
			},
		},
	}, path)
}

// weworkerStashOwn keeps what the user had in the custom slot before
// magpie's first write, as one JSON object under weworker.own (empty
// strings included, so Disconnect can put the file back as it was), so
// Disconnect puts it back even after WeWorker has saved the file whole
// since, which the byte-for-byte restore can't.
func weworkerStashOwn(get func(string) (string, bool)) {
	had := map[string]any{}
	for _, k := range weworkerKeys {
		if v, ok := get(k); ok {
			had[k] = v
		}
	}
	if len(had) == 0 {
		return
	}
	b, _ := json.Marshal(had)
	stash(map[string]string{weworkerOwn: string(b)})
}

// weworkerOff is the model field's empty Set: magpie's keys go, what the
// user had in the custom slot comes back from the stash (empty strings
// included), keys magpie wrote that the user had none of go.
func weworkerOff(path string, get func(string) (string, bool), set func(...edit.KV) error) error {
	var had map[string]any
	if raw := stashShared()[weworkerOwn]; raw != "" {
		json.Unmarshal([]byte(raw), &had)
	}
	var kvs []edit.KV
	var dels []string
	for _, k := range weworkerKeys {
		if v, ok := had[k]; ok {
			kvs = append(kvs, edit.KV{Path: k, Value: v})
			continue
		}
		dels = append(dels, k)
	}
	forget(weworkerOwn)
	if len(kvs) > 0 {
		if err := set(kvs...); err != nil {
			return err
		}
	}
	if len(dels) > 0 {
		return edit.DelJSON(path, dels...)
	}
	return nil
}

// weworkerOwnModels are the models of the user's own provider slots in
// settings.json, as provider/model, and the pick now when it is none of
// them (the custom slot on their own endpoint).
func weworkerOwnModels(path, cur string) []Option {
	var out []Option
	for _, p := range []string{"anthropic", "glm", "deepseek"} {
		if m, _ := edit.GetJSON(path, "model_"+p); m != "" {
			out = append(out, Option{Value: p + "/" + m, Icon: modelIcon("", m)})
		}
	}
	if cur != "" && !usesMagpie(cur) && !slices.ContainsFunc(out, func(o Option) bool { return o.Value == cur }) {
		out = append([]Option{{Value: cur, Icon: modelIcon("", cur)}}, out...)
	}
	return out
}
