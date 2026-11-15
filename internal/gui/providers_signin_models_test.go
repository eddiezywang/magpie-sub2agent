package gui

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/plugin"
	"github.com/yetone/magpie/internal/testenv"
)

func TestProvidersWaitListsNewPluginAccount(t *testing.T) {
	bun := testenv.Bun(t)
	dir := t.TempDir()
	testenv.SetHome(t, dir)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(dir, "config"))
	t.Setenv("XDG_CACHE_HOME", filepath.Join(dir, "cache"))
	t.Setenv("MAGPIE_BUN", bun)
	t.Setenv("MAGPIE_PLUGIN_MARKET", "off")
	t.Cleanup(plugin.Settle)
	src := filepath.Join(dir, "provider.mjs")
	if err := os.WriteFile(src, []byte(`export default async () => ({
 config: async c => {c.provider ??= {};c.provider.firstlogin={name:'First Login',npm:'@ai-sdk/openai-compatible',api:'https://fixture.invalid/v1',models:{}}},
 auth:{provider:'firstlogin',methods:[],loader:async()=>({apiKey:'fixture'})},
 provider:{id:'firstlogin',models:async(p,{auth})=>{
  if(!auth?.access)return {};
  await new Promise(r=>setTimeout(r,2000));
  return {'first-login-model':{name:'First Login Model'}};
 }}
})`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.Add(t.Context(), src); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.Providers(t.Context()); err != nil {
		t.Fatal(err)
	}
	if _, err := plugin.Import(t.Context(), "firstlogin", map[string]any{"type": "oauth", "access": "fixture", "accountId": "fixture-user"}); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	providerRoutes(mux, nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("GET", "/api/providers?wait=1", nil))
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"id":"first-login-model"`) {
		t.Fatalf("first editor response has no account models (HTTP %d)", w.Code)
	}
}
