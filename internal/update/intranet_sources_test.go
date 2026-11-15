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
	if got := internalAssetSources(primary.URL + "/releases/../private"); got != nil {
		t.Fatalf("unsafe alternate %v", got)
	}
}

func TestThreeSourcesOnlyThirdAvailable(t *testing.T) {
	payload := []byte("third source")
	sum := sha256.Sum256(payload)
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(payload) }))
	defer good.Close()
	bad1 := httptest.NewServer(http.NotFoundHandler())
	defer bad1.Close()
	bad2 := httptest.NewServer(http.NotFoundHandler())
	defer bad2.Close()
	old := internalReleaseSources
	t.Cleanup(func() { internalReleaseSources = old })
	internalReleaseSources = []string{bad1.URL + "/releases", bad2.URL + "/releases", good.URL + "/releases"}
	a := Asset{URL: bad1.URL + "/releases/v1/file.exe", Size: int64(len(payload)), SHA256: hex.EncodeToString(sum[:])}
	out := filepath.Join(t.TempDir(), "file.exe")
	if err := download(context.Background(), a, out); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(out)
	if err != nil || string(got) != string(payload) {
		t.Fatalf("download %q: %v", got, err)
	}
}

func TestInternalLatestPrefersNewestValidFeed(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	oldKey, oldSources := internalSigningKey, internalReleaseSources
	internalSigningKey = base64.StdEncoding.EncodeToString(pub)
	t.Cleanup(func() { internalSigningKey = oldKey; internalReleaseSources = oldSources })
	serve := func(version string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			sums := ""
			rel := Release{Version: version, Assets: map[string]Asset{}, Signed: &Signed{Sums: sums, Sig: base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte("magpie release "+version+"\n"+sums)))}}
			_ = json.NewEncoder(w).Encode(rel)
		}))
	}
	old, fresh := serve("0.1.3913-sub2agent.6"), serve("0.1.3913-sub2agent.7")
	defer old.Close()
	defer fresh.Close()
	internalReleaseSources = []string{old.URL, fresh.URL}
	got, err := latestInternal(context.Background(), "")
	if err != nil || got.Version != "0.1.3913-sub2agent.7" {
		t.Fatalf("latest = %v, %v", got, err)
	}
}

func TestInternalLatestOnlyThirdFeedAvailable(t *testing.T) {
	pub, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	oldKey, oldSources := internalSigningKey, internalReleaseSources
	internalSigningKey = base64.StdEncoding.EncodeToString(pub)
	t.Cleanup(func() { internalSigningKey = oldKey; internalReleaseSources = oldSources })
	bad1 := httptest.NewServer(http.NotFoundHandler())
	defer bad1.Close()
	bad2 := httptest.NewServer(http.NotFoundHandler())
	defer bad2.Close()
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		version := "0.1.3913-sub2agent.7"
		rel := Release{Version: version, Assets: map[string]Asset{}, Signed: &Signed{Sig: base64.StdEncoding.EncodeToString(ed25519.Sign(private, []byte("magpie release "+version+"\n")))}}
		_ = json.NewEncoder(w).Encode(rel)
	}))
	defer good.Close()
	internalReleaseSources = []string{bad1.URL, bad2.URL, good.URL}
	got, err := latestInternal(context.Background(), "")
	if err != nil || got == nil || got.Version != "0.1.3913-sub2agent.7" {
		t.Fatalf("third source = %v, %v", got, err)
	}
}
