//go:build intranet

package plugin

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The host's start (hostBun) resolves Bun the internal way — beside the
// app, the embedded archive, the pinned package at the enterprise mirror
// — never GitHub, which the distribution refuses. A plugin request used
// to end "Bun runtime not ready: downloading Bun 1.4.2 failed: public
// resource downloads are disabled: github.com" (1.0.0-beta.11): bunAtHand
// knew only the downloaded magpie-bun, so every fresh install fetched
// from GitHub and failed.
func TestHostBunComesFromTheEnterpriseMirror(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("the pinned internal runtime is a Windows x64 build")
	}
	bunHome(t, BunVersion, time.Now())
	executable := []byte("fixture runtime")
	digest := sha256.Sum256(executable)
	oldDigest := internalBunSHA256
	internalBunSHA256 = hex.EncodeToString(digest[:])
	t.Cleanup(func() { internalBunSHA256 = oldDigest })
	var archive bytes.Buffer
	gz := gzip.NewWriter(&archive)
	tarball := tar.NewWriter(gz)
	if err := tarball.WriteHeader(&tar.Header{Name: "package/bin/bun.exe", Mode: 0755, Size: int64(len(executable))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarball.Write(executable); err != nil {
		t.Fatal(err)
	}
	tarball.Close()
	gz.Close()
	var asked atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/@oven/bun-windows-x64-baseline/" + BunVersion:
			_ = json.NewEncoder(w).Encode(map[string]any{"name": internalBunPackage, "version": BunVersion, "dist": map[string]string{"tarball": "https://registry.npmjs.org/@oven/bun-windows-x64-baseline/-/bun-windows-x64-baseline-" + BunVersion + ".tgz"}})
		case "/@oven/bun-windows-x64-baseline/-/bun-windows-x64-baseline-" + BunVersion + ".tgz":
			asked.Add(1)
			_, _ = w.Write(archive.Bytes())
		default:
			t.Errorf("unexpected path: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	old := internalBunRegistry
	internalBunRegistry = server.URL
	t.Cleanup(func() { internalBunRegistry = old })
	t.Cleanup(endBunFetches)
	readyWait(t, 10*time.Second)

	bun, err := hostBun(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(bun); err != nil || string(data) != string(executable) {
		t.Fatalf("the host runs on %s: %v (%q)", bun, err, data)
	}
	if n := asked.Load(); n != 1 {
		t.Fatalf("the mirror's tarball was taken %d times, want once", n)
	}

	// the next start finds the runtime on disk and asks no mirror
	internalBunRegistry = "http://127.0.0.1:1"
	endBunFetches()
	if _, err := hostBun(context.Background()); err != nil {
		t.Fatal(err)
	}
	if n := asked.Load(); n != 1 {
		t.Fatalf("a runtime on disk re-fetched the mirror (%d tries)", n)
	}
}

// A Bun the internal build can't get (no mirror) is said as it is, and a
// GitHub address is never asked: the caller sees the mirror's failure.
func TestHostBunWithoutTheMirrorSaysSo(t *testing.T) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		t.Skip("the pinned internal runtime is a Windows x64 build")
	}
	bunHome(t, BunVersion, time.Now())
	old := internalBunRegistry
	internalBunRegistry = "http://127.0.0.1:1"
	t.Cleanup(func() { internalBunRegistry = old })
	t.Cleanup(endBunFetches)
	readyWait(t, 10*time.Millisecond)

	_, err := hostBun(context.Background())
	var nr *BunNotReadyError
	if !errors.As(err, &nr) || nr.Err == nil {
		t.Fatalf("hostBun = %v, want the mirror's failure", err)
	}
	if !strings.Contains(err.Error(), "插件运行时") {
		t.Fatalf("the failure doesn't say the runtime download failed: %v", err)
	}
	if strings.Contains(err.Error(), "github.com") {
		t.Fatalf("the host still went to GitHub: %v", err)
	}
}
