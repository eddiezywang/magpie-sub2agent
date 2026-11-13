package provider

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/plugin"
)

type legacySub2AgentSource struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Provider string `json:"provider"`
	Name     string `json:"displayName"`
	Status   string `json:"status"`
	Enabled  *bool  `json:"enabled"`
	Secret   string `json:"secretRef"`
	Auth     struct {
		Secret string `json:"secretRef"`
	} `json:"auth"`
	Models       []string       `json:"models"`
	DefaultModel string         `json:"defaultModel"`
	Subscription map[string]any `json:"subscription"`
	ModelCredits map[string]any `json:"modelCredits"`
	Endpoint     struct {
		Base     string `json:"baseUrl"`
		Protocol string `json:"protocolFamily"`
	} `json:"endpoint"`
	Transport string `json:"transportPreset"`
}

func readLegacyJSON(path string, out any) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	b, err := io.ReadAll(io.LimitReader(f, 8<<20+1))
	if err != nil || len(b) > 8<<20 {
		return errors.New("legacy credential file is unreadable or too large")
	}
	return json.Unmarshal(b, out)
}

// ImportSub2AgentAuth reads the old app's files without modifying them. Only
// retained source kinds are imported. Authentication already in this app wins.
func ImportSub2AgentAuth() (int, error) {
	if !distribution.Internal {
		return 0, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return 0, errors.New("无法确定旧版认证目录")
	}
	return importSub2AgentAuth(filepath.Join(home, ".sub2agent", "data"), legacyUnprotect)
}

func importSub2AgentAuth(root string, unprotect func([]byte) ([]byte, error)) (int, error) {
	var old struct {
		Version int `json:"version"`
		Desktop struct {
			Sources []legacySub2AgentSource `json:"sources"`
		} `json:"desktop"`
	}
	if err := readLegacyJSON(filepath.Join(root, "proxy.json"), &old); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return 0, nil
		}
		return 0, errors.New("旧版 Sub2Agent 认证文件无法读取，已保留原文件")
	}
	if old.Version != 1 {
		return 0, errors.New("旧版 Sub2Agent 配置版本无法识别，已保留原文件")
	}
	markerPath := filepath.Join(filepath.Dir(Path()), "sub2agent-auth-import.json")
	imported := map[string]bool{}
	if err := readLegacyJSON(markerPath, &imported); err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, errors.New("旧认证迁移记录无法读取，未覆盖现有认证")
	}
	if imported == nil {
		return 0, errors.New("旧认证迁移记录无效，未覆盖现有认证")
	}
	count, failed := 0, false
	for _, source := range old.Desktop.Sources {
		if source.ID == "" || source.Status != "ready" {
			continue
		}
		if source.Kind != "endpoint" && source.Enabled != nil && !*source.Enabled {
			continue
		}
		// Legacy auth_profiles/tokens are CodeBuddy credentials, never WorkBuddy
		// SSO or an API key. They are deliberately not mislabelled as a retained source.
		if source.Kind != "endpoint" && source.Provider != "workbuddy" {
			continue
		}
		sum := sha256.Sum256([]byte(source.Kind + "\x00" + source.Provider + "\x00" + source.ID))
		identity := hex.EncodeToString(sum[:16])
		if imported[identity] {
			continue
		}
		ref := source.Auth.Secret
		if ref == "" {
			ref = source.Secret
		}
		suffix, ok := strings.CutPrefix(ref, "secret:")
		if !ok || suffix == "" || strings.ContainsAny(suffix, "/\\:\x00") || suffix == "." || suffix == ".." {
			failed = true
			continue
		}
		var entry struct {
			Cipher string `json:"cipherText"`
		}
		if readLegacyJSON(filepath.Join(root, "secrets", suffix+".json"), &entry) != nil || entry.Cipher == "" {
			failed = true
			continue
		}
		secret, err := decodeLegacySecret(entry.Cipher, unprotect)
		if err != nil {
			failed = true
			continue
		}
		changed := false
		if source.Kind == "endpoint" {
			changed, err = importLegacyEndpoint(source, identity, string(secret))
		} else {
			changed, err = importLegacyWorkBuddy(source, identity, secret)
		}
		clear(secret)
		if err != nil {
			failed = true
			continue
		}
		imported[identity] = true
		raw, _ := json.MarshalIndent(imported, "", "  ")
		if err = writePrivate(markerPath, append(raw, '\n')); err != nil {
			return count, errors.New("认证已转换，但迁移记录保存失败；下次启动会安全重试")
		}
		if changed {
			count++
		}
	}
	if failed {
		return count, errors.New("部分旧认证无法转换，请在供应商页重新认证；原文件和现有认证均已保留")
	}
	return count, nil
}

func importLegacyWorkBuddy(source legacySub2AgentSource, identity string, secret []byte) (bool, error) {
	var bundle map[string]any
	if json.Unmarshal(secret, &bundle) != nil || str(bundle["accessToken"]) == "" || str(bundle["userId"]) == "" || str(bundle["enterpriseId"]) == "" {
		return false, errors.New("incomplete enterprise credential")
	}
	bundle["models"] = source.Models
	bundle["defaultModel"] = source.DefaultModel
	if mapping := source.Subscription["modelMap"]; mapping != nil {
		bundle["modelMap"] = mapping
	}
	if len(source.ModelCredits) > 0 {
		bundle["modelCredits"] = source.ModelCredits
	}
	access, _ := json.Marshal(bundle)
	raw, _ := json.Marshal(map[string]any{"type": "oauth", "access": string(access), "refresh": "", "expires": 0, "accountId": str(bundle["userId"])})
	changed := false
	err := plugin.EditAuth(func(entries map[string]json.RawMessage) (bool, error) {
		for key, existing := range entries {
			if key != "sub2agent-workbuddy" && !strings.HasPrefix(key, "sub2agent-workbuddy#") {
				continue
			}
			var saved struct {
				Access string `json:"access"`
			}
			var previous map[string]any
			if json.Unmarshal(existing, &saved) == nil && json.Unmarshal([]byte(saved.Access), &previous) == nil && previous["userId"] == bundle["userId"] && previous["enterpriseId"] == bundle["enterpriseId"] {
				return false, nil
			}
		}
		key := "sub2agent-workbuddy#legacy-" + identity
		if _, exists := entries[key]; exists {
			return false, nil
		}
		entries[key] = raw
		changed = true
		return true, nil
	})
	return changed, err
}

func importLegacyEndpoint(s legacySub2AgentSource, identity, key string) (bool, error) {
	if strings.TrimSpace(key) == "" || s.Endpoint.Base == "" {
		return false, errors.New("incomplete endpoint credential")
	}
	f, err := read()
	if err != nil {
		return false, err
	}
	id := "legacy-" + identity
	for _, existing := range f.Providers {
		if existing.ID == id {
			return false, nil
		}
	}
	p := Provider{ID: id, Name: s.Name, Key: key, Models: s.Models, Off: s.Enabled != nil && !*s.Enabled}
	if p.Name == "" {
		p.Name = "Sub2Agent 来源"
	}
	protocol := s.Endpoint.Protocol
	if protocol == "" {
		protocol = s.Transport
	}
	switch protocol {
	case "anthropic_messages":
		p.Anthropic = s.Endpoint.Base
	case "openai_chat":
		p.Chat = s.Endpoint.Base
	case "openai_responses":
		p.Responses = s.Endpoint.Base
	default:
		return false, errors.New("unsupported legacy endpoint protocol")
	}
	if p.Anthropic == codingPlanPreset.Anthropic {
		p.Preset = codingPlanPreset.ID
		p.Name = "TIG Coding Plan"
		p.AuthHeader = AuthBearer
	}
	// Do not duplicate an endpoint already configured in the new app, nor
	// replace a user's more recent credential or routing/model preferences.
	for _, existing := range f.Providers {
		if existing.Anthropic == p.Anthropic && existing.Chat == p.Chat && existing.Responses == p.Responses {
			return false, nil
		}
	}
	if err := Save(p); err != nil {
		return false, err
	}
	return true, nil
}
