//go:build windows && intranet

package gui

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"unsafe"

	"github.com/yetone/magpie/internal/provider"
	"golang.org/x/sys/windows"
)

func TestLegacySupplierWindowsAPIImportsOnce(t *testing.T) {
	h := t.TempDir()
	t.Setenv("HOME", h)
	t.Setenv("USERPROFILE", h)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(h, "config"))
	root := filepath.Join(h, ".sub2agent", "data")
	if err := os.MkdirAll(filepath.Join(root, "secrets"), 0700); err != nil {
		t.Fatal(err)
	}
	protect := func(name, key string) {
		t.Helper()
		b := []byte(key)
		in := windows.DataBlob{Size: uint32(len(b)), Data: &b[0]}
		var out windows.DataBlob
		if err := windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out); err != nil {
			t.Fatal(err)
		}
		cipher := append([]byte(nil), unsafe.Slice(out.Data, out.Size)...)
		windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
		data, _ := json.Marshal(map[string]string{"cipherText": base64.StdEncoding.EncodeToString(cipher)})
		if err := os.WriteFile(filepath.Join(root, "secrets", name+".json"), data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	protect("a", "synthetic-key-a")
	protect("b", "synthetic-key-b")
	old := []byte(`{"version":1,"desktop":{"sources":[{"id":"a","kind":"endpoint","provider":"direct","displayName":"A","status":"ready","secretRef":"secret:a","models":["model-a"],"endpoint":{"baseUrl":"https://fixture.invalid/v1","protocolFamily":"openai_chat"}},{"id":"b","kind":"endpoint","provider":"direct","displayName":"B","status":"ready","secretRef":"secret:b","models":["model-b"],"endpoint":{"baseUrl":"https://fixture.invalid/v1","protocolFamily":"openai_chat"}}]}}`)
	file := filepath.Join(root, "proxy.json")
	if err := os.WriteFile(file, old, 0600); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	legacySupplierPreviewRoutes(mux)
	call := func(method, path string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(method, path, nil))
		return w
	}
	if w := call("GET", "/api/legacy-suppliers"); w.Code != 200 || bytes.Contains(w.Body.Bytes(), []byte("secret:a")) {
		t.Fatal("preview failed or leaked a credential reference")
	}
	if w := call("POST", "/api/legacy-suppliers/dismiss"); w.Code != 200 {
		t.Fatalf("dismiss: %d", w.Code)
	}
	if _, err := os.Stat(provider.Path()); !os.IsNotExist(err) {
		t.Fatal("dismiss created providers")
	}
	var result struct {
		Imported int    `json:"imported"`
		Error    string `json:"error"`
		Preview  struct {
			Complete bool `json:"complete"`
		} `json:"preview"`
	}
	w := call("POST", "/api/legacy-suppliers/import")
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Imported != 2 || result.Error != "" || !result.Preview.Complete {
		t.Fatalf("import response: %s %v", w.Body, err)
	}
	providers := provider.All()
	found := map[string]bool{}
	for _, p := range providers {
		if p.Key == "synthetic-key-a" || p.Key == "synthetic-key-b" {
			found[p.Key] = true
		}
	}
	if len(found) != 2 {
		t.Fatal("two distinct endpoint keys were not retained")
	}
	w = call("POST", "/api/legacy-suppliers/import")
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Imported != 0 {
		t.Fatalf("repeat response: %s %v", w.Body, err)
	}
	after, err := os.ReadFile(file)
	if err != nil || !bytes.Equal(old, after) {
		t.Fatal("old config changed")
	}
}
