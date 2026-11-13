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
