package plugin

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/appdir"
	"github.com/yetone/magpie/internal/distribution"
)

const internalBunRegistry = "http://wnpm.weoa.com:8001"
const internalBunPackage = "@oven/bun-windows-x64-baseline"

// Pinned executable digest, independently verified from the packaged release.
const internalBunSHA256 = "15277c59ccd6c6c20f8dc9716c2b59c1776320d606b6a8658f70be8799519ca4"

// CanStart includes an internal first-run download, unlike HasBun's read-only
// presence check. This keeps preinstalled providers discoverable in light builds.
func CanStart() bool {
	if Running() || HasBun() {
		return true
	}
	if distribution.Internal {
		for _, entry := range Load().Plugins {
			if !entry.Off {
				return true
			}
		}
	}
	return false
}

func internalBunCache() string {
	return filepath.Join(appdir.Cache(), "plugin-runtime", BunVersion, "bun.exe")
}

func internalNPMBun(ctx context.Context) (string, error) {
	if runtime.GOOS != "windows" || runtime.GOARCH != "amd64" {
		return "", fmt.Errorf("此平台请使用附带插件运行时的完整包")
	}
	bunMu.Lock()
	defer bunMu.Unlock()
	target := internalBunCache()
	if err := fetchNPMBun(ctx, internalBunRegistry, target, internalBunSHA256); err != nil {
		return "", err
	}
	return target, nil
}

func bunDigest(path, expected string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, io.LimitReader(f, 150<<20)); err != nil {
		return false
	}
	return hex.EncodeToString(h.Sum(nil)) == expected
}

// Download metadata and the platform archive directly: no npm, install scripts,
// public-registry fallback, or archive-controlled extraction paths are involved.
func fetchNPMBun(ctx context.Context, registry, target, expected string) error {
	if bunDigest(target, expected) {
		return nil
	}
	base, err := url.Parse(registry)
	if err != nil || base.Host == "" {
		return fmt.Errorf("插件运行时仓库配置无效")
	}
	client := *http.DefaultClient
	client.Timeout = 12 * time.Second
	client.CheckRedirect = func(r *http.Request, via []*http.Request) error {
		if len(via) >= 5 || r.URL.Host != base.Host || r.URL.Scheme != base.Scheme || r.URL.User != nil {
			return fmt.Errorf("运行时下载不允许跳转到其他服务")
		}
		return nil
	}
	get := func(address string) (*http.Response, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, address, nil)
		if err != nil {
			return nil, fmt.Errorf("插件运行时下载地址无效")
		}
		response, err := client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("无法下载插件运行时，请连接行内网络或 VPN 后重试；已有运行时和账户未改变")
		}
		if response.StatusCode != http.StatusOK {
			response.Body.Close()
			return nil, fmt.Errorf("插件运行时仓库返回 HTTP %d，请重试或联系管理员预缓存 Bun %s", response.StatusCode, BunVersion)
		}
		return response, nil
	}
	response, err := get(strings.TrimRight(registry, "/") + "/@oven%2Fbun-windows-x64-baseline/" + BunVersion)
	if err != nil {
		return err
	}
	var metadata struct {
		Name    string `json:"name"`
		Version string `json:"version"`
		Dist    struct {
			Tarball string `json:"tarball"`
		} `json:"dist"`
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&metadata)
	response.Body.Close()
	if err != nil || metadata.Name != internalBunPackage || metadata.Version != BunVersion {
		return fmt.Errorf("插件运行时仓库元数据无效，请联系管理员检查指定版本")
	}
	archiveURL, err := url.Parse(metadata.Dist.Tarball)
	if err != nil || archiveURL.User != nil || !strings.HasSuffix(archiveURL.Path, ".tgz") || !strings.Contains(archiveURL.Path, "bun-windows-x64-baseline-") {
		return fmt.Errorf("插件运行时仓库返回的包地址无效")
	}
	// Mirrors sometimes leave registry.npmjs.org in dist.tarball. Always fetch
	// that path through the configured internal mirror, never the public host.
	archiveURL.Scheme, archiveURL.Host = base.Scheme, base.Host
	archiveURL.RawQuery, archiveURL.Fragment = "", ""
	client.Timeout = 120 * time.Second
	response, err = get(archiveURL.String())
	if err != nil {
		return err
	}
	defer response.Body.Close()
	gz, err := gzip.NewReader(io.LimitReader(response.Body, 100<<20))
	if err != nil {
		return fmt.Errorf("插件运行时下载包损坏，请重试")
	}
	defer gz.Close()
	reader := tar.NewReader(io.LimitReader(gz, 150<<20))
	if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
		return err
	}
	for count := 0; count < 32; count++ {
		header, err := reader.Next()
		if err != nil {
			break
		}
		if header.Name != "package/bin/bun.exe" {
			continue
		}
		if header.Typeflag != tar.TypeReg || header.Size <= 0 || header.Size > 120<<20 {
			break
		}
		file, err := os.CreateTemp(filepath.Dir(target), ".bun-download-")
		if err != nil {
			return err
		}
		stage := file.Name()
		defer os.Remove(stage)
		_, copyErr := io.CopyN(file, reader, header.Size)
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil || !bunDigest(stage, expected) {
			return fmt.Errorf("插件运行时完整性校验失败，未启用下载文件，请重试或联系管理员")
		}
		if err = os.Chmod(stage, 0700); err != nil {
			return err
		}
		// Only an invalid cache can reach this point; valid caches return above.
		if err = os.Remove(target); err != nil && !os.IsNotExist(err) {
			return err
		}
		return os.Rename(stage, target)
	}
	return fmt.Errorf("插件运行时下载包缺少有效可执行文件，请联系管理员")
}
