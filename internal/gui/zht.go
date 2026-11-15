package gui

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/proc"
)

type zhtKey struct {
	ID      string `json:"apiKeyId"`
	Value   string `json:"apiKeyValue"`
	User    string `json:"apiKeyUser"`
	Expires int64  `json:"expireTime"`
}

// Ignore CLI banners and update notices. Never include the CLI output in errors:
// it contains plaintext credentials even when the command exits unsuccessfully.
func parseZHTKeys(output []byte, now time.Time) ([]zhtKey, error) {
	if len(output) > 1<<20 {
		return nil, errors.New("智汇通 CLI 返回内容过大，请直接填写 API Key")
	}
	for offset := 0; offset < len(output); {
		i := bytes.IndexByte(output[offset:], '{')
		if i < 0 {
			break
		}
		offset += i
		var reply struct {
			Code string   `json:"respCode"`
			Data []zhtKey `json:"data"`
		}
		decoder := json.NewDecoder(bytes.NewReader(output[offset:]))
		err := decoder.Decode(&reply)
		offset++
		if err != nil || reply.Code == "" {
			continue
		}
		if reply.Code != "0000" {
			return nil, errors.New("智汇通未授权成功，请完成 CLI 登录后重试")
		}
		var keys []zhtKey
		seen := map[string]bool{}
		for _, key := range reply.Data {
			key.Value = strings.TrimSpace(key.Value)
			if !strings.Contains(key.ID, "8899") || key.Value == "" || seen[key.ID] || (key.Expires > 0 && key.Expires <= now.UnixMilli()) {
				continue
			}
			seen[key.ID] = true
			keys = append(keys, key)
		}
		if len(keys) == 0 {
			return nil, errors.New("未找到 apiKeyId 包含 8899 的有效密钥；请确认权限，或直接填写 API Key")
		}
		return keys, nil
	}
	return nil, errors.New("无法识别智汇通 CLI 返回结果，请完成登录后重试，或直接填写 API Key")
}

// A bounded writer keeps noisy or broken CLIs from filling memory. Neither
// stdout nor stderr is forwarded to a terminal, application log or screenshot.
type zhtOutput struct{ bytes.Buffer }

func (b *zhtOutput) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 1<<20 {
		return 0, errors.New("CLI output limit exceeded")
	}
	return b.Buffer.Write(p)
}

func readZHTKeys(ctx context.Context) ([]zhtKey, error) {
	name, arg := "zht-dt-cli", "api-key"
	path, err := exec.LookPath(name)
	if err != nil {
		name, arg = "zht-cli", "apikey"
		path, err = exec.LookPath(name)
	}
	if err != nil {
		return nil, errors.New("尚未安装智汇通 CLI，请按页面命令安装后重试；安装完成后可能需要重启应用")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	cmd := proc.CommandContext(ctx, path, arg)
	cmd.Env = append(os.Environ(), "ZHT_UPDATE_CHECK=off")
	var out zhtOutput
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, errors.New("智汇通登录等待超时或已取消，请重试，或直接填写 API Key")
		}
		return nil, errors.New("智汇通 CLI 未成功完成，请确认已获访问权限并完成登录后重试")
	}
	return parseZHTKeys(out.Bytes(), time.Now())
}

func zhtRoutes(mux *http.ServeMux) {
	if !distribution.Internal {
		return
	}
	mux.HandleFunc("POST /api/provider-zht/key", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		keys, err := readZHTKeys(r.Context())
		if err != nil {
			fail(w, err)
			return
		}
		writeJSON(w, map[string]any{"keys": keys})
	})
}
