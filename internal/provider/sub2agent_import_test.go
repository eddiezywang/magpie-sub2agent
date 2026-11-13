//go:build intranet

package provider

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/yetone/magpie/internal/plugin"
)

func legacyImportFixture(t *testing.T) string {
	t.Helper()
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
 {"id":"source-plan","kind":"endpoint","provider":"direct","displayName":"Plan","status":"ready","secretRef":"secret:plan","transportPreset":"anthropic_messages","endpoint":{"baseUrl":"http://172.21.11.82/public","protocolFamily":"anthropic_messages"},"models":["fixture-model"]},
 {"id":"disabled-other","kind":"subscription","provider":"codebuddy","status":"ready","secretRef":"secret:missing"}
 ]}}`)
	if err := os.WriteFile(filepath.Join(root, "proxy.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return root
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
	if err != nil || count != 0 {
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
	if err != nil || p.Preset != "aiep-coding-plan" || p.Name != "TIG Coding Plan" || p.Chat != "http://172.21.11.82/public/v1" || p.Key != "fixture-plan-key" {
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
	root := filepath.Join(t.TempDir(), "missing-old-config")
	if _, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil }); err != nil {
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
	if n, err := importSub2AgentAuth(root, func(b []byte) ([]byte, error) { return b, nil }); err != nil || n != 0 {
		t.Fatal("repair is not idempotent")
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
