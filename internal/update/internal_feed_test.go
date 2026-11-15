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
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/yetone/magpie/internal/distribution"
)

func TestInternalFeedRequiresItsOwnSignature(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	old := internalSigningKey
	internalSigningKey = base64.StdEncoding.EncodeToString(pub)
	t.Cleanup(func() { internalSigningKey = old })
	t.Setenv("MAGPIE_UPDATE_FEED", "http://evil.invalid")
	if Feed() != distribution.AppFeed {
		t.Fatal("external feed overrides internal feed")
	}
	rel := &Release{Version: "1.0.0", Assets: map[string]Asset{"magpie-windows-amd64.exe": {SHA256: strings.Repeat("a", 64)}}}
	if rel.verify() == nil {
		t.Fatal("unsigned release accepted")
	}
	sums := strings.Repeat("a", 64) + "  magpie-windows-amd64.exe\n"
	rel.Signed = &Signed{Sums: sums, Sig: base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte("magpie release "+rel.Version+"\n"+sums)))}
	if err := rel.verify(); err != nil {
		t.Fatal(err)
	}
	rel.Version = "1.0.1"
	if rel.verify() == nil {
		t.Fatal("changed version accepted")
	}
}

func TestInternalSignedFeedAndDownload(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	old := internalSigningKey
	internalSigningKey = base64.StdEncoding.EncodeToString(pub)
	t.Cleanup(func() { internalSigningKey = old })
	payload := []byte("fixture binary")
	digest := sha256.Sum256(payload)
	h := hex.EncodeToString(digest[:])
	name := "magpie-windows-amd64.exe"
	sums := h + "  " + name + "\n"
	signature := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, []byte("magpie release 1.2.3\n"+sums)))
	var base string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/latest.json" {
			json.NewEncoder(w).Encode(Release{Version: "1.2.3", Signed: &Signed{Sums: sums, Sig: signature}, Assets: map[string]Asset{name: {URL: base + "/binary", SHA256: h}}})
			return
		}
		_, _ = w.Write(payload)
	}))
	defer srv.Close()
	base = srv.URL
	rel, err := latestFrom(context.Background(), base+"/latest.json", "")
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(t.TempDir(), "sub2agent.new")
	if err := download(context.Background(), rel.Assets[name], target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil || string(got) != string(payload) {
		t.Fatalf("download = %q %v", got, err)
	}
}
