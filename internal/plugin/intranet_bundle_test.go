//go:build intranet

package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func internalTestZIP(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var b bytes.Buffer
	z := zip.NewWriter(&b)
	for name, data := range files {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write([]byte(data)); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestIntranetBundleInstallsAndPreservesPreviousOnFailure(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("XDG_CACHE_HOME", t.TempDir())
	old := http.DefaultClient
	t.Cleanup(func() {
		http.DefaultClient = old
		marketList = nil
		marketAt = time.Time{}
		marketUpdated = time.Time{}
		marketChecked = time.Time{}
		marketErr = nil
	})
	manifest := `{"name":"internal-test","version":"1.0.0","type":"module","main":"index.js"}`
	payload := internalTestZIP(t, map[string]string{"package.json": manifest, "index.js": "export const plugin=async()=>({});"})
	digest := sha256.Sum256(payload)
	bundle := &InternalBundle{Version: "1.0.0", URL: "http://172.21.0.177/magpie/plugins/dist/test.zip", SHA256: hex.EncodeToString(digest[:]), Bytes: int64(len(payload))}
	http.DefaultClient = &http.Client{Transport: marketStatusTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.Hostname() != "172.21.0.177" {
			t.Fatalf("public request: %s", r.URL.Hostname())
		}
		body := payload
		if strings.HasSuffix(r.URL.Path, "registry.json") {
			body, _ = json.Marshal(registry{Plugins: []Listing{{Package: "internal-test", Name: "Test", Bundle: bundle}}})
		}
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(body)), Request: r}, nil
	})}
	marketList = nil
	marketUpdated = time.Time{}
	ctx := context.Background()
	if err := install(ctx, "internal-test@latest"); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(filepath.Join(Target("internal-test"), "index.js"))
	if err != nil {
		t.Fatal(err)
	}
	bundle.SHA256 = strings.Repeat("0", 64)
	RefreshMarket()
	if err := install(ctx, "internal-test@latest"); err == nil {
		t.Fatal("accepted wrong digest")
	}
	after, _ := os.ReadFile(filepath.Join(Target("internal-test"), "index.js"))
	if !bytes.Equal(before, after) {
		t.Fatal("failed install changed previous plugin")
	}
	bundle.SHA256 = hex.EncodeToString(digest[:])
	RefreshMarket()
	if err := installAt(ctx, "internal-test", "9.9.9"); err == nil {
		t.Fatal("silently installed a different version")
	}
	for _, files := range []map[string]string{
		{"package.json": manifest, "index.js": "x", "../outside": "x"},
		{"package.json": strings.TrimSuffix(manifest, "}") + `,"scripts":{"postinstall":"bad"}}`, "index.js": "x"},
		{"package.json": strings.TrimSuffix(manifest, "}") + `,"dependencies":{"external":"latest"}}`, "index.js": "x"},
		{"package.json": manifest},
	} {
		if err := extractInternalBundle(internalTestZIP(t, files), t.TempDir(), "internal-test", "1.0.0"); err == nil {
			t.Fatalf("accepted unsafe/incomplete bundle: %+v", files)
		}
	}
}
