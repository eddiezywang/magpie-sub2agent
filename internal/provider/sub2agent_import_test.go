//go:build intranet

package provider

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/plugin"
)

func legacyImportFixture(t *testing.T) string {
	t.Helper()
	previous := legacySubscriptionEnabled
	legacySubscriptionEnabled = func(string) bool { return true }
	t.Cleanup(func() { legacySubscriptionEnabled = previous })
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "secrets"), 0700)
	write := func(ref, secret string) {
		raw, _ := json.Marshal(map[string]string{"cipherText": base64.StdEncoding.EncodeToString([]byte(secret))})
		if err := os.WriteFile(filepath.Join(root, "secrets", ref+".json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	write("wb", `{"accessToken":"fixture-access","refreshToken":"fixture-refresh","userId":"fixture-user","enterpriseId":"fixture-tenant","expiresAt":4102416000000}`)
	write("plan", "fixture-plan-key")
	raw := []byte(`{"version":1,"auth_profiles":[{"id":1,"type":"client_credentials"}],"tokens":{"1":{"access_token":"fixture-other-source"}},"desktop":{"sources":[
 {"id":"source-wb","kind":"subscription","provider":"workbuddy","displayName":"WorkBuddy","status":"ready","enabled":true,"auth":{"secretRef":"secret:wb"},"models":["Enterprise Model"],"defaultModel":"Enterprise Model","subscription":{"modelMap":{"Enterprise Model":"vendor-model"}}},
 {"id":"source-plan","kind":"endpoint","provider":"direct","displayName":"Plan","status":"ready","secretRef":"secret:plan","transportPreset":"anthropic_messages","endpoint":{"baseUrl":"http://172.21.11.82/public","protocolFamily":"anthropic_messages"},"models":["fixture-model"]}
 ]}}`)
	if err := os.WriteFile(filepath.Join(root, "proxy.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestSub2AgentImportDoesNotClaimDisabledPluginSuccess(t *testing.T) {
	azureHome(t)
	root := legacyImportFixture(t)
	legacySubscriptionEnabled = func(string) bool { return false }
	count, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil })
	if err == nil || count != 1 {
		t.Fatalf("disabled plugin should remain unresolved: %d %v", count, err)
	}
	entries, err := plugin.AuthEntries()
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatal("disabled plugin received a credential")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(Path()), "sub2agent-import-complete.json")); !os.IsNotExist(err) {
		t.Fatal("disabled plugin was marked complete")
	}
}

func TestSub2AgentImportIsIdempotentAndPreservesOriginal(t *testing.T) {
	azureHome(t)
	root := legacyImportFixture(t)
	original, _ := os.ReadFile(filepath.Join(root, "proxy.json"))
	decode := func(b []byte) ([]byte, error) { return b, nil }
	count, err := importSub2AgentAuth(root, decode)
	if err != nil || count != 2 {
		t.Fatalf("imported %d: %v", count, err)
	}
	entries, err := plugin.AuthEntries()
	if err != nil || len(entries) != 1 {
		t.Fatalf("wrong plugin auth count %d: %v", len(entries), err)
	}
	for _, raw := range entries {
		var a struct {
			Access string `json:"access"`
		}
		var bundle struct {
			ModelMap map[string]string `json:"modelMap"`
		}
		json.Unmarshal(raw, &a)
		json.Unmarshal([]byte(a.Access), &bundle)
		if bundle.ModelMap["Enterprise Model"] != "vendor-model" {
			t.Fatal("private model mapping lost")
		}
	}
	count, err = importSub2AgentAuth(root, decode)
	if err != nil || count != 0 {
		t.Fatalf("repeat import changed data: %d %v", count, err)
	}
	after, _ := os.ReadFile(filepath.Join(root, "proxy.json"))
	if !bytes.Equal(original, after) {
		t.Fatal("original app's config was changed")
	}
	// A user deliberately deletes an imported account: next start must not
	// resurrect it, even though the original file still contains the credential.
	plugin.EditAuth(func(m map[string]json.RawMessage) (bool, error) {
		for k := range m {
			delete(m, k)
		}
		return true, nil
	})
	count, err = importSub2AgentAuth(root, decode)
	if err != nil || count != 0 {
		t.Fatal("deleted account was imported again")
	}
}

func TestSub2AgentImportKeepsDifferentKeysAtSameEndpoint(t *testing.T) {
	azureHome(t)
	a := legacySub2AgentSource{ID: "a", Kind: "endpoint", Name: "Team A", Models: []string{"model-a"}}
	a.Endpoint.Base, a.Endpoint.Protocol = "https://fixture.invalid/v1", "openai_chat"
	b := a
	b.ID, b.Name, b.Models = "b", "Team B", []string{"model-b"}
	if changed, err := importLegacyEndpoint(a, "fixture-a", "key-a"); err != nil || !changed {
		t.Fatalf("first endpoint: %v %v", changed, err)
	}
	if changed, err := importLegacyEndpoint(b, "fixture-b", "key-b"); err != nil || !changed {
		t.Fatalf("second distinct credential lost: %v %v", changed, err)
	}
	first, err := Find("legacy-fixture-a")
	if err != nil || first.Key != "key-a" || len(first.Models) != 1 || first.Models[0] != "model-a" {
		t.Fatal("first endpoint changed")
	}
	second, err := Find("legacy-fixture-b")
	if err != nil || second.Key != "key-b" || len(second.Models) != 1 || second.Models[0] != "model-b" {
		t.Fatal("second endpoint lost its key or model selection")
	}
}

func TestSub2AgentImportCompletionAndPartialRetry(t *testing.T) {
	azureHome(t)
	root := legacyImportFixture(t)
	secretFile := filepath.Join(root, "secrets", "plan.json")
	secret, err := os.ReadFile(secretFile)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(secretFile); err != nil {
		t.Fatal(err)
	}
	decode := func(b []byte) ([]byte, error) { return b, nil }
	if count, err := importSub2AgentAuth(root, decode); err == nil || count != 1 {
		t.Fatalf("partial import should retain first success and report failure: %d %v", count, err)
	}
	complete := filepath.Join(filepath.Dir(Path()), "sub2agent-import-complete.json")
	if _, err := os.Stat(complete); !os.IsNotExist(err) {
		t.Fatal("partial import was marked complete")
	}
	if err := os.WriteFile(secretFile, secret, 0600); err != nil {
		t.Fatal(err)
	}
	if count, err := importSub2AgentAuth(root, decode); err != nil || count != 1 {
		t.Fatalf("retry should import only the failed source: %d %v", count, err)
	}
	var done struct {
		Complete bool `json:"complete"`
	}
	if err := readLegacyJSON(complete, &done); err != nil || !done.Complete {
		t.Fatal("completion not saved")
	}
	if count, err := importSub2AgentAuth(root, decode); err != nil || count != 0 {
		t.Fatalf("completed import was repeated: %d %v", count, err)
	}
}

func TestSub2AgentPreviewIsReadOnlyAndIdentifiesIcons(t *testing.T) {
	azureHome(t)
	root := legacyImportFixture(t)
	file := filepath.Join(root, "proxy.json")
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var old map[string]any
	if err := json.Unmarshal(before, &old); err != nil {
		t.Fatal(err)
	}
	desktop := old["desktop"].(map[string]any)
	desktop["sources"] = append(desktop["sources"].([]any), map[string]any{"id": "cib", "kind": "endpoint", "provider": "direct", "displayName": "CIB", "status": "ready", "secretRef": "secret:private", "endpoint": map[string]any{"baseUrl": "http://10.32.33.46:11288/efllmas-agw/v1"}})
	before, _ = json.Marshal(old)
	if err := os.WriteFile(file, before, 0600); err != nil {
		t.Fatal(err)
	}
	p, err := legacySub2AgentPreview(root)
	if err != nil || !p.Found || p.Complete || len(p.Sources) != 3 {
		t.Fatalf("preview: %+v %v", p, err)
	}
	if p.Sources[0].Icon != "workbuddy-color" || p.Sources[1].Icon != "tig-color" || p.Sources[1].Name != "TIG-Coding-Plan" || p.Sources[2].Icon != "cib-zht" {
		t.Fatalf("wrong icons: %+v", p.Sources)
	}
	data, _ := json.Marshal(p)
	if bytes.Contains(data, []byte("secret:")) || bytes.Contains(data, []byte("fixture-access")) {
		t.Fatal("preview exposed credentials")
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(before, after) {
		t.Fatal("preview changed old config")
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(Path()), "sub2agent-import-complete.json")); !os.IsNotExist(err) {
		t.Fatal("preview wrote completion marker")
	}
	for _, raw := range []string{"http://10.32.33.46:11288.evil/efllmas-agw/v1", "http://user@10.32.33.46:11288/efllmas-agw/v1", "http://10.32.33.46:11288/other"} {
		if knownCIBEndpoint(raw) {
			t.Errorf("misclassified %s", raw)
		}
	}
}

func TestSub2AgentImportCIBPreservesSourceAndIcon(t *testing.T) {
	azureHome(t)
	s := legacySub2AgentSource{ID: "cib", Kind: "endpoint", Name: "old name", Models: []string{"model-a"}}
	s.Endpoint.Base, s.Endpoint.Protocol = "http://10.32.33.46:11288/efllmas-agw/v1", "openai_chat"
	if changed, err := importLegacyEndpoint(s, "cib-fixture", "fixture-key"); err != nil || !changed {
		t.Fatalf("import: %v %v", changed, err)
	}
	p, err := Find("legacy-cib-fixture")
	if err != nil || p.Name != "CIB-智汇通-APIKEY" || p.Icon != "cib-zht" || p.Preset != "cib-zht-apikey" || p.Chat != s.Endpoint.Base || p.Key != "fixture-key" {
		t.Fatal("CIB source, icon or credential changed")
	}
}

func TestSub2AgentImportMultipleSubscriptionKinds(t *testing.T) {
	azureHome(t)
	previous := legacySubscriptionEnabled
	legacySubscriptionEnabled = func(string) bool { return true }
	t.Cleanup(func() { legacySubscriptionEnabled = previous })
	root := legacyImportFixture(t)
	writeSecret := func(ref, value string) {
		t.Helper()
		raw, _ := json.Marshal(map[string]string{"cipherText": base64.StdEncoding.EncodeToString([]byte(value))})
		if err := os.WriteFile(filepath.Join(root, "secrets", ref+".json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeSecret("cb", "codebuddy-fixture-token")
	writeSecret("tr", `{"token":"trae-token","refreshToken":"trae-refresh"}`)
	file := filepath.Join(root, "proxy.json")
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		t.Fatal(err)
	}
	desktop := data["desktop"].(map[string]any)
	desktop["sources"] = append(desktop["sources"].([]any),
		map[string]any{"id": "cb", "kind": "subscription", "provider": "codebuddy", "status": "ready", "secretRef": "secret:cb", "models": []string{"cb-model"}, "subscription": map[string]any{"userId": "cb-user"}},
		map[string]any{"id": "tr", "kind": "subscription", "provider": "trae", "status": "ready", "secretRef": "secret:tr", "models": []string{"tr-model"}, "subscription": map[string]any{"userId": "tr-user", "baseUrl": "https://fixture.invalid"}})
	raw, _ = json.Marshal(data)
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if count, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil }); err != nil || count != 4 {
		t.Fatalf("mixed sources: %d %v", count, err)
	}
	entries, err := plugin.AuthEntries()
	if err != nil {
		t.Fatal(err)
	}
	kinds := map[string]bool{}
	for key, value := range entries {
		for _, kind := range []string{"codebuddy", "workbuddy", "trae"} {
			if !strings.HasPrefix(key, "sub2agent-"+kind+"#") {
				continue
			}
			var auth struct {
				Access string `json:"access"`
			}
			var bundle map[string]any
			if json.Unmarshal(value, &auth) != nil || json.Unmarshal([]byte(auth.Access), &bundle) != nil {
				t.Fatal("bad auth bundle")
			}
			if kind == "codebuddy" && bundle["accessToken"] != "codebuddy-fixture-token" {
				t.Fatal("CodeBuddy token missing")
			}
			if kind == "trae" && (bundle["refreshToken"] != "trae-refresh" || bundle["baseUrl"] != "https://fixture.invalid") {
				t.Fatal("Trae bundle incomplete")
			}
			kinds[kind] = true
		}
	}
	if len(kinds) != 3 {
		t.Fatalf("subscription kinds missing: %v", kinds)
	}
	if count, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil }); err != nil || count != 0 {
		t.Fatalf("repeat: %d %v", count, err)
	}
}

func TestSub2AgentImportKeepsCurrentCredentialsAndRejectsCorruption(t *testing.T) {
	azureHome(t)
	root := legacyImportFixture(t)
	plugin.EditAuth(func(m map[string]json.RawMessage) (bool, error) {
		m["sub2agent-workbuddy"] = json.RawMessage(`{"type":"oauth","access":"{\"accessToken\":\"newer\",\"userId\":\"fixture-user\",\"enterpriseId\":\"fixture-tenant\"}","accountId":"fixture-user"}`)
		return true, nil
	})
	plan, _ := FromPreset("aiep-coding-plan")
	plan.Key = "newer-plan"
	plan.Models = []string{"custom-model"}
	if err := Save(plan); err != nil {
		t.Fatal(err)
	}
	count, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil })
	if err != nil || count != 1 {
		t.Fatalf("overwrote current settings: %d %v", count, err)
	}
	saved, err := Find(plan.ID)
	if err != nil || saved.Key != "newer-plan" || len(saved.Models) != 1 || saved.Models[0] != "custom-model" {
		t.Fatal("new configuration changed")
	}
	os.WriteFile(filepath.Join(root, "proxy.json"), []byte(`{"version":1,"desktop":`), 0600)
	if _, err = importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil }); err == nil {
		t.Fatal("corrupt source accepted")
	}
}

func TestSub2AgentImportRecognizesOpenAITIG(t *testing.T) {
	azureHome(t)
	root := legacyImportFixture(t)
	path := filepath.Join(root, "proxy.json")
	raw, _ := os.ReadFile(path)
	raw = bytes.ReplaceAll(raw, []byte("anthropic_messages"), []byte("openai_chat"))
	raw = bytes.ReplaceAll(raw, []byte("http://172.21.11.82/public"), []byte("http://172.21.11.82/public/v1"))
	os.WriteFile(path, raw, 0600)
	if _, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil }); err != nil {
		t.Fatal(err)
	}
	p, err := Find("sub2agent-tigcodingplan")
	if err != nil || p.Preset != "aiep-coding-plan" || p.Name != "TIG-Coding-Plan" || p.Chat != "http://172.21.11.82/public/v1" || p.Key != "fixture-plan-key" {
		t.Fatal("OpenAI TIG imported as a generic endpoint")
	}
}

func TestSub2AgentImportRepairsAlreadyImportedTIG(t *testing.T) {
	azureHome(t)
	p := Provider{ID: "legacy-fixture", Name: "我的 API", Chat: "http://172.21.11.82/public/v1", Key: "newer-key", Models: []string{"glm-5.3-flash-zp"}, Off: true}
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	f, _ := read()
	f.Groups = []Group{{ID: "fixture", Members: []string{"legacy-fixture/glm-5.3-flash-zp"}}}
	if err := store(f); err != nil {
		t.Fatal(err)
	}
	if _, err := repairImportedCodingPlans(); err != nil {
		t.Fatal(err)
	}
	fixed, err := Find("sub2agent-tigcodingplan")
	if err != nil || fixed.Preset != "aiep-coding-plan" || fixed.Key != "newer-key" || !fixed.Off || len(fixed.Models) != 1 {
		t.Fatal("already imported TIG was not repaired with preferences intact")
	}
	old, err := Find("legacy-fixture")
	if err != nil || old.ID != fixed.ID {
		t.Fatal("old model references no longer resolve")
	}
	f, _ = read()
	if f.Groups[0].Members[0] != "sub2agent-tigcodingplan/glm-5.3-flash-zp" {
		t.Fatal("group reference not moved")
	}
	if n, err := repairImportedCodingPlans(); err != nil || n != 0 {
		t.Fatal("repair is not idempotent")
	}
}

func TestSub2AgentImportDoesNotRepairOrRewriteRouting(t *testing.T) {
	azureHome(t)
	p := Provider{ID: "legacy-fixture", Name: "API", Chat: "http://172.21.11.82/public/v1", Key: "fixture-key"}
	if err := Save(p); err != nil {
		t.Fatal(err)
	}
	f, err := read()
	if err != nil {
		t.Fatal(err)
	}
	f.Groups = []Group{{ID: "fixture", Members: []string{"legacy-fixture/model"}}}
	if err := store(f); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "missing-old-config")
	if n, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil }); err != nil || n != 0 {
		t.Fatalf("unexpected import: %d %v", n, err)
	}
	f, err = read()
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Groups) != 1 || f.Groups[0].Members[0] != "legacy-fixture/model" || len(f.Providers) != 1 || f.Providers[0].ID != "legacy-fixture" {
		t.Fatal("supplier import changed an existing provider or routing group")
	}
}

func TestCodingPlanEndpointRecognitionIsExact(t *testing.T) {
	for _, s := range []string{"http://172.21.11.82/public", "http://172.21.11.82/public/v1/", "https://172.21.11.82/public/v1/messages"} {
		if !knownCodingPlanEndpoint(s) {
			t.Errorf("missed %s", s)
		}
	}
	for _, s := range []string{"http://172.21.11.82.evil/public/v1", "http://172.21.11.82/other", "http://user@172.21.11.82/public", "http://172.21.11.82/public?redirect=1", "http://172.21.11.82:9999/public"} {
		if knownCodingPlanEndpoint(s) {
			t.Errorf("misclassified %s", s)
		}
	}
}
