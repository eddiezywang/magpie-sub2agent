//go:build intranet

package update

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestInternalSourcesFallback(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	oldKey, oldSources := internalSigningKey, internalReleaseSources
	internalSigningKey = base64.StdEncoding.EncodeToString(pub)
	t.Cleanup(func() { internalSigningKey = oldKey; internalReleaseSources = oldSources })
	payload := []byte("independent signed release")
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])
	sums := digest + "  magpie-windows-amd64.exe\n"
	var primary *httptest.Server
	mirror := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/releases/latest.json" {
			rel := Release{Version: "0.1.3913-sub2agent.7", Assets: map[string]Asset{"magpie-windows-amd64.exe": {URL: primary.URL + "/releases/0.1.3913-sub2agent.7/magpie-windows-amd64.exe", SHA256: digest, Size: int64(len(payload))}}, Signed: &Signed{Sums: sums, Sig: base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte("magpie release 0.1.3913-sub2agent.7\n"+sums)))}}
			_ = json.NewEncoder(w).Encode(rel)
			return
		}
		if r.URL.Path == "/releases/0.1.3913-sub2agent.7/magpie-windows-amd64.exe" {
			_, _ = w.Write(payload)
			return
		}
		http.NotFound(w, r)
	}))
	defer mirror.Close()
	primary = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) }))
	defer primary.Close()
	internalReleaseSources = []string{primary.URL + "/releases", mirror.URL + "/releases"}
	rel, err := latestInternal(context.Background(), "")
	if err != nil {
		t.Fatal(err)
	}
	a := rel.Assets["magpie-windows-amd64.exe"]
	dst := filepath.Join(t.TempDir(), "app.exe")
	if err = download(context.Background(), a, dst); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(dst)
	if err != nil || string(got) != string(payload) {
		t.Fatalf("download = %q, %v", got, err)
	}
	if got := internalAlternateAsset(primary.URL + "/releases/../private"); got != "" {
		t.Fatal(fmt.Sprintf("unsafe alternate %s", got))
	}
}
