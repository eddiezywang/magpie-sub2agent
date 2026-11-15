package plugin

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/distribution"
)

// InternalBundle contains reviewed offline code, without dependency installation.
// Format 1 is a bundled ESM; format 2 declares exact hook/page files in its manifest.
type InternalBundle struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
	Bytes   int64  `json:"bytes"`
}

const internalBundleLimit = 32 << 20

func installInternalBundle(ctx context.Context, pkg, version string) error {
	if !pkgName.MatchString(pkg) {
		return fmt.Errorf("invalid internal plugin package")
	}
	ls, status := MarketWithStatus(ctx)
	var bundle *InternalBundle
	for _, l := range ls {
		if l.Package == pkg {
			bundle = l.Bundle
			break
		}
	}
	if bundle == nil {
		if status.State == "unavailable" {
			return internalServiceError(status.Reason, status.HTTPStatus)
		}
		return fmt.Errorf("内网目录尚未发布 %s 的完整离线包，可先导入本地插件文件夹", pkg)
	}
	if !exactVersion.MatchString(bundle.Version) || version != "" && version != "latest" && version != bundle.Version {
		return fmt.Errorf("内网目录未发布请求的插件版本，请刷新目录或联系管理员")
	}
	u, err := url.Parse(bundle.URL)
	if err != nil || distribution.AssetURL(bundle.URL) != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasPrefix(u.Path, "/magpie/plugins/dist/") || !strings.HasSuffix(u.Path, ".zip") {
		return fmt.Errorf("插件包地址不是受支持的内网制品地址")
	}
	if sum, err := hex.DecodeString(bundle.SHA256); err != nil || len(sum) != sha256.Size || bundle.Bytes <= 0 || bundle.Bytes > internalBundleLimit {
		return fmt.Errorf("插件包缺少有效的校验信息或超出大小限制")
	}
	c, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	b, err := fetchJSONFaithful(c, bundle.URL, bundle.Bytes+1)
	if err != nil {
		reason, code := marketFailure(err)
		return internalServiceError(reason, code)
	}
	sum := sha256.Sum256(b)
	if int64(len(b)) != bundle.Bytes || !strings.EqualFold(hex.EncodeToString(sum[:]), bundle.SHA256) {
		return fmt.Errorf("插件包校验失败，已保留当前安装，请联系管理员重新发布")
	}
	installMu.Lock()
	defer installMu.Unlock()
	target := packageTarget(pkg)
	parent := filepath.Dir(target)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	stage, err := os.MkdirTemp(parent, ".bundle-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err := extractInternalBundle(b, stage, pkg, bundle.Version); err != nil {
		return err
	}
	receipt := bundleReceipt{Package: pkg, Version: bundle.Version, Files: map[string]string{}}
	err = filepath.WalkDir(stage, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		name, err := filepath.Rel(stage, path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(data)
		receipt.Files[filepath.ToSlash(name)] = hex.EncodeToString(sum[:])
		return nil
	})
	if err != nil {
		return err
	}
	raw, err := json.Marshal(receipt)
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(stage, ".internal-bundle.json"), raw, 0600); err != nil {
		return err
	}
	backup := stage + ".previous"
	hadOld := false
	if _, err := os.Lstat(target); err == nil {
		if err := os.Rename(target, backup); err != nil {
			return err
		}
		hadOld = true
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(stage, target); err != nil {
		if hadOld {
			if restore := os.Rename(backup, target); restore != nil {
				return fmt.Errorf("install: %v; rollback: %v", err, restore)
			}
		}
		return err
	}
	if hadOld {
		_ = os.RemoveAll(backup)
	}
	return nil
}

func extractInternalBundle(b []byte, dir, pkg, version string) error {
	z, err := zip.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		return fmt.Errorf("插件离线包不是有效的 ZIP 文件")
	}
	if len(z.File) > 128 {
		return fmt.Errorf("插件离线包文件数量超出限制")
	}
	seen := map[string]bool{}
	folded := map[string]bool{}
	var total uint64
	for _, f := range z.File {
		if folded[strings.ToLower(f.Name)] || !safeBundlePath(f.Name) || !allowedBundleFile(f.Name) || !f.Mode().IsRegular() {
			return fmt.Errorf("插件离线包包含不受支持的文件或链接")
		}
		seen[f.Name] = true
		folded[strings.ToLower(f.Name)] = true
		total += f.UncompressedSize64
		if f.UncompressedSize64 > internalBundleLimit || total > 2*internalBundleLimit {
			return fmt.Errorf("插件离线包解压后超出大小限制")
		}
		r, err := f.Open()
		if err != nil {
			return err
		}
		data, err := io.ReadAll(io.LimitReader(r, internalBundleLimit+1))
		r.Close()
		if err != nil {
			return err
		}
		if len(data) > internalBundleLimit {
			return fmt.Errorf("plugin file too large")
		}
		target := filepath.Join(dir, filepath.FromSlash(f.Name))
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		if err := os.WriteFile(target, data, 0o644); err != nil {
			return err
		}
	}
	var manifest struct {
		Format int      `json:"sub2agentBundle,omitempty"`
		Files  []string `json:"files"`
		Magpie struct {
			Hooks string `json:"hooks"`
			Page  struct {
				File string `json:"file"`
			} `json:"page"`
		} `json:"magpie"`
		Name         string         `json:"name"`
		Version      string         `json:"version"`
		Main         string         `json:"main"`
		Type         string         `json:"type"`
		Dependencies map[string]any `json:"dependencies"`
		Optional     map[string]any `json:"optionalDependencies"`
		Peer         map[string]any `json:"peerDependencies"`
		Scripts      map[string]any `json:"scripts"`
	}
	m, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil || json.Unmarshal(m, &manifest) != nil || manifest.Name != pkg || manifest.Version != version || manifest.Type != "module" || len(manifest.Dependencies)+len(manifest.Optional)+len(manifest.Peer)+len(manifest.Scripts) > 0 {
		return fmt.Errorf("插件必须是名称、版本匹配且不含外部依赖或安装脚本的完整 ESM 包")
	}
	if manifest.Format == 2 {
		declared := map[string]bool{"package.json": true}
		for _, name := range manifest.Files {
			if !safeBundlePath(name) || declared[name] || !seen[name] {
				return fmt.Errorf("插件声明的文件缺失或不合法")
			}
			declared[name] = true
		}
		for name := range seen {
			if !declared[name] {
				return fmt.Errorf("插件离线包包含未声明文件")
			}
		}
		hasEntry := false
		for _, entry := range []string{manifest.Main, manifest.Magpie.Hooks, manifest.Magpie.Page.File} {
			if entry == "" {
				continue
			}
			entry = strings.TrimPrefix(entry, "./")
			if !safeBundlePath(entry) || !seen[entry] {
				return fmt.Errorf("插件入口缺失或不合法")
			}
			hasEntry = true
		}
		if !hasEntry {
			return fmt.Errorf("插件没有可加载的入口")
		}
	} else if manifest.Format != 0 && manifest.Format != 1 || !seen["index.js"] || manifest.Main != "index.js" {
		return fmt.Errorf("插件必须是完整 ESM 包或已声明的离线页面与钩子包")
	} else {
		for name := range seen {
			if name != "package.json" && name != "index.js" && name != "README.md" && name != "LICENSE" {
				return fmt.Errorf("单文件插件包含不受支持的文件")
			}
		}
	}
	return nil
}

func allowedBundleFile(name string) bool {
	if name == "LICENSE" || name == "NOTICE" || name == "README.md" {
		return true
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".json", ".js", ".mjs", ".html", ".css", ".svg":
		return true
	}
	return false
}

func internalServiceError(reason string, code int) error {
	switch reason {
	case "timeout":
		return fmt.Errorf("连接内网插件服务器超时，请检查内网或 VPN 后重试；当前插件安装未改变")
	case "refused":
		return fmt.Errorf("内网插件服务器拒绝连接，请联系管理员检查服务和 80 端口")
	case "http":
		return fmt.Errorf("内网插件服务器返回 HTTP %d，请稍后重试或联系管理员", code)
	case "cancelled":
		return context.Canceled
	default:
		return fmt.Errorf("无法连接内网插件服务器，请检查内网或 VPN 后重试")
	}
}

var bundlePath = regexp.MustCompile(`^[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*$`)

func safeBundlePath(name string) bool {
	if !bundlePath.MatchString(name) {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "." || part == ".." || strings.HasSuffix(part, ".") || strings.HasPrefix(part, ".internal-") {
			return false
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '0' && base[3] <= '9' {
			return false
		}
	}
	return true
}
