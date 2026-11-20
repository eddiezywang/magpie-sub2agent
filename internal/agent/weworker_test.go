package agent

import (
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/edit"
	"github.com/yetone/magpie/internal/gateway"
)

// weworkerUser is the settings.json of a WeWorker 1.0.2 on its own
// Anthropic and GLM keys (fields spelled as its DEFAULT_SETTINGS writes
// them, two-space indent).
func weworkerUser() string {
	return `{
  "onboarding_completed": true,
  "active_provider": "anthropic",
  "api_key": "sk-ant-theirs",
  "base_url": "https://api.anthropic.com",
  "model": "claude-sonnet-4-6",
  "api_key_anthropic": "sk-ant-theirs",
  "model_anthropic": "claude-sonnet-4-6",
  "api_key_glm": "glm-theirs",
  "model_glm": "glm-4.7",
  "api_key_deepseek": "",
  "model_deepseek": "",
  "api_key_custom": "",
  "model_custom": "",
  "base_url_custom": "",
  "theme": "dark"
}`
}

func weworkerOf(t *testing.T) *Agent {
	t.Helper()
	for _, x := range All() {
		if x.ID == "weworker" {
			return x
		}
	}
	t.Fatal("no weworker in All()")
	return nil
}

// WeWorker is wired in its one settings.json: the custom slot on the
// gateway's Anthropic Messages, active_provider on it, and magpie's key.
// The user's other slots and settings stay; the custom slot's own values
// go back on Disconnect, whole file byte for byte where WeWorker hasn't
// saved since.
func TestWeWorker(t *testing.T) {
	home := syncHome(t)
	a := weworkerOf(t)
	dir := filepath.Join(home, ".weworker")
	path := filepath.Join(dir, "settings.json")
	if a.Name != "WeWorker" || a.Icon != "weworker-color" || a.Bin != "" || a.Dir != dir || a.Path != path {
		t.Fatalf("%+v", a)
	}
	// no file, no row
	if a.Detected() {
		t.Fatal("WeWorker detected with no ~/.weworker")
	}
	writeFile(t, path, weworkerUser())
	if !a.Detected() || a.Field("model").Get() != "anthropic/claude-sonnet-4-6" {
		t.Fatalf("detected %v, model %q", a.Detected(), a.Field("model").Get())
	}
	// the user's own slots' models, and magpie's, are offered
	var vals []string
	for _, o := range a.Field("model").Options(a.Values()) {
		vals = append(vals, o.Value)
	}
	if !slices.Contains(vals, "anthropic/claude-sonnet-4-6") || !slices.Contains(vals, "glm/glm-4.7") || !slices.Contains(vals, "magpie/relay/glm-4.6") {
		t.Fatalf("options %v", vals)
	}

	was := readFile(path)
	if err := a.Connect(); err != nil {
		t.Fatal(err)
	}
	for k, want := range map[string]string{
		"active_provider":   "custom",
		"base_url_custom":   gateway.URL(),
		"api_key_custom":    "magpie-weworker",
		"model_custom":      "relay/glm-4.6",
		"models_url_custom": gateway.URL() + "/v1/models",
		// the user's own, kept
		"api_key_anthropic": "sk-ant-theirs",
		"model_anthropic":   "claude-sonnet-4-6",
		"api_key_glm":       "glm-theirs",
		"model_glm":         "glm-4.7",
		"theme":             "dark",
	} {
		if v, _ := edit.GetJSON(path, k); v != want {
			t.Fatalf("%s = %q:\n%s", k, v, readFile(path))
		}
	}
	if v, ok := edit.GetJSON(path, "weworker_protocol_custom"); ok && v != "anthropic_messages" {
		t.Fatalf("weworker_protocol_custom = %q:\n%s", v, readFile(path))
	}
	if got := a.Field("model").Get(); got != "magpie/relay/glm-4.6" {
		t.Fatalf("model %q:\n%s", got, readFile(path))
	}
	if c := a.Check(); c != "" {
		t.Fatal(c)
	}
	// the custom slot's own values are stashed for Disconnect (read-only;
	// unstash would take them out)
	if own := stashShared()["weworker.own"]; !strings.Contains(own, `"active_provider":"anthropic"`) {
		t.Fatalf("stash %q", own)
	}

	if err := a.Disconnect(); err != nil {
		t.Fatal(err)
	}
	// the file was untouched since Connect: byte for byte what it was
	if readFile(path) != was {
		t.Fatalf("Disconnect didn't restore the file:\n%s", readFile(path))
	}
	if a.Field("model").Get() != "anthropic/claude-sonnet-4-6" {
		t.Fatalf("model %q after Disconnect", a.Field("model").Get())
	}
}

// WeWorker saves its settings whole on any change of its own, which
// defeats the byte-for-byte restore: the custom slot's own values then
// come back from the stash, and what WeWorker wrote in the meantime stays.
func TestWeWorkerOffAfterTheirSave(t *testing.T) {
	home := syncHome(t)
	a := weworkerOf(t)
	path := filepath.Join(home, ".weworker", "settings.json")
	// the user's own custom endpoint, not magpie's
	body := weworkerUser()
	body = strings.Replace(body, `"active_provider": "anthropic",`, `"active_provider": "custom",`, 1)
	body = strings.Replace(body, `"api_key_custom": "",
  "model_custom": "",
  "base_url_custom": "",`, `"api_key_custom": "theirs",
  "model_custom": "deepseek-v4",
  "base_url_custom": "https://llm.them.example",`, 1)
	writeFile(t, path, body)
	if a.Field("model").Get() != "custom/deepseek-v4" {
		t.Fatalf("model %q", a.Field("model").Get())
	}
	if c := a.Check(); c != "" {
		t.Fatal(c) // their own endpoint is no drift
	}
	if err := a.Connect(); err != nil {
		t.Fatal(err)
	}
	if got := a.Field("model").Get(); got != "magpie/relay/glm-4.6" {
		t.Fatalf("model %q:\n%s", got, readFile(path))
	}
	if c := a.Check(); c != "" {
		t.Fatal(c)
	}
	// WeWorker re-saves: their key moves into the encrypted blob, and a
	// setting of its own arrives
	body = readFile(path)
	body = strings.Replace(body, `"api_key_custom": "magpie-weworker",`, `"api_key_custom": "",`, 1)
	body = strings.Replace(body, `"theme": "dark"`, `"theme": "dark", "_encrypted": {"v": 1, "fields": {"api_key_custom": "sm4-cipher", "api_key_anthropic": "sm4-ant"}}`, 1)
	writeFile(t, path, body)
	// the encrypted key is still a key: no drift
	if c := a.Check(); c != "" {
		t.Fatal(c)
	}
	if got := a.Field("model").Get(); got != "magpie/relay/glm-4.6" {
		t.Fatalf("model %q:\n%s", got, readFile(path))
	}
	if err := a.Disconnect(); err != nil {
		t.Fatal(err)
	}
	for k, want := range map[string]string{
		"active_provider":                     "custom",
		"base_url_custom":                     "https://llm.them.example",
		"api_key_custom":                      "theirs",
		"model_custom":                        "deepseek-v4",
		"models_url_custom":                   "",
		"_encrypted.fields.api_key_anthropic": "sm4-ant",
		"theme":                               "dark",
	} {
		if v, _ := edit.GetJSON(path, k); v != want {
			t.Fatalf("%s = %q:\n%s", k, v, readFile(path))
		}
	}
	if a.Field("model").Get() != "custom/deepseek-v4" {
		t.Fatalf("model %q after Disconnect", a.Field("model").Get())
	}
	if c := a.Check(); c != "" {
		t.Fatal(c)
	}
}

// Drift, where magpie set WeWorker up and the wiring was changed since.
func TestWeWorkerDrift(t *testing.T) {
	home := syncHome(t)
	a := weworkerOf(t)
	path := filepath.Join(home, ".weworker", "settings.json")
	writeFile(t, path, weworkerUser())
	if err := a.Connect(); err != nil {
		t.Fatal(err)
	}
	if c := a.Check(); c != "" {
		t.Fatal(c)
	}
	// the address changed
	edit.SetJSON(path, edit.KV{Path: "base_url_custom", Value: "http://127.0.0.1:9"})
	if c := a.Check(); c == "" {
		t.Fatalf("no drift:\n%s", readFile(path))
	}
	// a key of theirs and no other: gone
	edit.SetJSON(path, edit.KV{Path: "base_url_custom", Value: gateway.URL()}, edit.KV{Path: "api_key_custom", Value: ""})
	if c := a.Check(); c == "" {
		t.Fatalf("no drift:\n%s", readFile(path))
	}
	// their provider switched to: no drift, the row just reads not wired
	edit.SetJSON(path, edit.KV{Path: "active_provider", Value: "anthropic"}, edit.KV{Path: "api_key_custom", Value: "magpie-weworker"})
	if c := a.Check(); c != "" {
		t.Fatal(c)
	}
	// the wiring moved away and was put back: the pick still reads as
	// magpie's by its key, so Reapply finds the field to set again
	edit.SetJSON(path, edit.KV{Path: "active_provider", Value: "custom"}, edit.KV{Path: "base_url_custom", Value: "http://127.0.0.1:9"})
	if d := a.Drift(); d == nil || d.Kind != "unwired" {
		t.Fatalf("drift: %+v", d)
	}
	if err := a.Reapply(); err != nil {
		t.Fatal(err)
	}
	if d := a.Drift(); d != nil {
		t.Fatalf("still drifted after Reapply: %+v", d)
	}
}
