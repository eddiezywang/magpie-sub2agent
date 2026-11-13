package plugin

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNPMBunVerifiedCacheAndInternalTarball(t *testing.T) {
	executable := []byte("fixture runtime")
	digest := sha256.Sum256(executable)
	want := hex.EncodeToString(digest[:])
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tarball := tar.NewWriter(gz)
	if err := tarball.WriteHeader(&tar.Header{Name: "package/bin/bun.exe", Mode: 0755, Size: int64(len(executable))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarball.Write(executable); err != nil {
		t.Fatal(err)
	}
	if err := tarball.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	var corrupt atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		switch r.URL.Path {
		case "/@oven/bun-windows-x64-baseline/" + BunVersion:
			_ = json.NewEncoder(w).Encode(map[string]any{"name": internalBunPackage, "version": BunVersion, "dist": map[string]string{"tarball": "https://registry.npmjs.org/@oven/bun-windows-x64-baseline/-/bun-windows-x64-baseline-" + BunVersion + ".tgz"}})
		case "/@oven/bun-windows-x64-baseline/-/bun-windows-x64-baseline-" + BunVersion + ".tgz":
			if corrupt.Load() {
				_, _ = w.Write([]byte("broken"))
				return
			}
			_, _ = w.Write(archive.Bytes())
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	target := filepath.Join(t.TempDir(), "runtime", "bun.exe")
	if err := fetchNPMBun(context.Background(), server.URL, target, want); err != nil {
		t.Fatal(err)
	}
	if !bunDigest(target, want) || requests.Load() != 2 {
		t.Fatal("runtime not installed from internal mirror")
	}
	failedTarget := filepath.Join(t.TempDir(), "bun.exe")
	if err := os.WriteFile(failedTarget, []byte("previous"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := fetchNPMBun(context.Background(), server.URL, failedTarget, strings.Repeat("0", 64)); err == nil {
		t.Fatal("accepted wrong executable digest")
	}
	data, _ := os.ReadFile(failedTarget)
	if string(data) != "previous" {
		t.Fatal("digest failure changed previous cache")
	}
	corrupt.Store(true)
	if err := fetchNPMBun(context.Background(), server.URL, failedTarget, want); err == nil {
		t.Fatal("accepted corrupt tarball")
	}
	before := requests.Load()
	server.Close()
	if err := fetchNPMBun(context.Background(), server.URL, target, want); err != nil {
		t.Fatal("offline cached runtime failed:", err)
	}
	if requests.Load() != before {
		t.Fatal("valid cache contacted server")
	}
}

func TestNPMBunFailuresPreserveCacheAndHideAddresses(t *testing.T) {
	target := filepath.Join(t.TempDir(), "bun.exe")
	if err := os.WriteFile(target, []byte("previous cache"), 0600); err != nil {
		t.Fatal(err)
	}
	for _, status := range []int{404, 503, 302} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if status == 302 {
				w.Header().Set("Location", "https://registry.npmjs.org/forbidden")
			}
			w.WriteHeader(status)
		}))
		err := fetchNPMBun(context.Background(), server.URL, target, strings.Repeat("0", 64))
		server.Close()
		if err == nil || strings.Contains(err.Error(), "127.0.0.1") || strings.Contains(err.Error(), "registry.npmjs.org") {
			t.Fatalf("unsafe/missing error: %v", err)
		}
		data, _ := os.ReadFile(target)
		if string(data) != "previous cache" {
			t.Fatal("failed download changed cache")
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := fetchNPMBun(ctx, "http://127.0.0.1:1", target, strings.Repeat("0", 64)); err == nil {
		t.Fatal("ignored cancellation")
	}
}
