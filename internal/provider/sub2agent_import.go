package provider

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	"github.com/yetone/magpie/internal/distribution"
	"github.com/yetone/magpie/internal/plugin"
)

var legacyImportMu sync.Mutex

// Never turn on a plugin the user has left off during a credential import.
// Its credential must not be reported as usable until its provider is enabled.
var legacySubscriptionEnabled = func(kind string) bool {
	for _, entry := range plugin.Load().Plugins {
		if plugin.Name(entry.Spec) == "@sub2agent/"+kind {
			return !entry.Off
		}
	}
	return false
}

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
	legacyImportMu.Lock()
	defer legacyImportMu.Unlock()
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
	outcomePath := filepath.Join(filepath.Dir(Path()), "sub2agent-import-outcomes.json")
	outcomes := map[string]string{}
	if err := readLegacyJSON(outcomePath, &outcomes); err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, errors.New("旧版供应商处理记录无法读取，未继续导入")
	}
	if outcomes == nil {
		return 0, errors.New("旧版供应商处理记录无效，未继续导入")
	}
	completePath := filepath.Join(filepath.Dir(Path()), "sub2agent-import-complete.json")
	var completion struct {
		Complete *bool `json:"complete"`
	}
	if err := readLegacyJSON(completePath, &completion); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return 0, errors.New("旧版供应商导入完成标记无法读取，未继续导入")
		}
	} else {
		if completion.Complete == nil {
			return 0, errors.New("旧版供应商导入完成标记无效，未继续导入")
		}
		if *completion.Complete {
			return 0, nil
		}
	}
	count, failed := 0, false
	for _, source := range old.Desktop.Sources {
		if source.ID == "" || source.Status != "ready" {
			failed = true
			continue
		}
		if source.Kind != "endpoint" && source.Enabled != nil && !*source.Enabled {
			failed = true
			continue
		}
		// Only explicit source records with a known provider are converted;
		// legacy auth_profiles/tokens alone do not establish the required bundle.
		if source.Kind != "endpoint" && source.Provider != "workbuddy" && source.Provider != "codebuddy" && source.Provider != "trae" {
			failed = true
			continue
		}
		if source.Kind != "endpoint" && !legacySubscriptionEnabled(source.Provider) {
			failed = true
			continue
		}
		identity := legacySourceID(source)
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
		} else if source.Provider == "workbuddy" {
			changed, err = importLegacyWorkBuddy(source, identity, secret)
		} else {
			changed, err = importLegacySubscription(source, identity, secret)
		}
		clear(secret)
		if err != nil {
			failed = true
			continue
		}
		if changed {
			outcomes[identity] = "imported"
		} else {
			outcomes[identity] = "existing"
		}
		outcomeJSON, _ := json.MarshalIndent(outcomes, "", "  ")
		if err = writePrivate(outcomePath, append(outcomeJSON, '\n')); err != nil {
			return count, errors.New("供应商已处理，但结果记录保存失败；可安全重试")
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
	if err := writePrivate(completePath, []byte("{\"complete\":true}\n")); err != nil {
		return count, errors.New("供应商已导入，但完成标记保存失败；可安全重试")
	}
	return count, nil
}

func importLegacySubscription(source legacySub2AgentSource, identity string, secret []byte) (bool, error) {
	bundle := map[string]any{}
	switch source.Provider {
	case "codebuddy":
		if strings.TrimSpace(string(secret)) == "" {
			return false, errors.New("missing CodeBuddy token")
		}
		bundle["accessToken"] = string(secret)
		for _, key := range []string{"userId", "enterpriseId", "domain", "sourcePath"} {
			if value := source.Subscription[key]; value != nil {
				bundle[key] = value
			}
		}
	case "trae":
		if json.Unmarshal(secret, &bundle) != nil || str(bundle["token"]) == "" || str(bundle["refreshToken"]) == "" {
			return false, errors.New("incomplete Trae credential")
		}
		for _, key := range []string{"baseUrl", "userId"} {
			if str(bundle[key]) == "" && source.Subscription[key] != nil {
				bundle[key] = source.Subscription[key]
			}
		}
	default:
		return false, errors.New("unsupported subscription")
	}
	bundle["models"], bundle["defaultModel"] = source.Models, source.DefaultModel
	if mapping := source.Subscription["modelMap"]; mapping != nil {
		bundle["modelMap"] = mapping
	}
	access, err := json.Marshal(bundle)
	if err != nil {
		return false, err
	}
	accountID := str(bundle["userId"])
	if accountID == "" {
		accountID = "legacy-" + identity
	}
	raw, err := json.Marshal(map[string]any{"type": "oauth", "access": string(access), "refresh": "", "expires": 0, "accountId": accountID})
	if err != nil {
		return false, err
	}
	prefix := "sub2agent-" + source.Provider
	changed := false
	err = plugin.EditAuth(func(entries map[string]json.RawMessage) (bool, error) {
		for key, value := range entries {
			if key != prefix && !strings.HasPrefix(key, prefix+"#") {
				continue
			}
			var existing struct {
				Access string `json:"access"`
			}
			var previous map[string]any
			if json.Unmarshal(value, &existing) != nil || json.Unmarshal([]byte(existing.Access), &previous) != nil {
				continue
			}
			if source.Provider == "codebuddy" && str(previous["accessToken"]) == str(bundle["accessToken"]) {
				return false, nil
			}
			if source.Provider == "trae" && str(previous["userId"]) != "" && str(previous["userId"]) == str(bundle["userId"]) && str(previous["baseUrl"]) == str(bundle["baseUrl"]) {
				return false, nil
			}
		}
		key := prefix + "#legacy-" + identity
		if _, exists := entries[key]; exists {
			return false, nil
		}
		entries[key] = raw
		changed = true
		return true, nil
	})
	return changed, err
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
	if knownCodingPlanEndpoint(s.Endpoint.Base) {
		id = FreeID("sub2agent-tigcodingplan")
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
	if knownCodingPlanEndpoint(s.Endpoint.Base) {
		p.Preset = codingPlanPreset.ID
		p.Name = "TIG-Coding-Plan"
		p.Icon = codingPlanPreset.Icon
		p.AuthHeader = AuthBearer
	}
	if knownCIBEndpoint(s.Endpoint.Base) {
		p.Preset, p.Name, p.Icon = zhtPreset.ID, zhtPreset.Name, zhtPreset.Icon
	}
	// The same endpoint may have several independent credentials and model
	// selections. Only an already saved credential is a duplicate.
	for _, existing := range f.Providers {
		if existing.Anthropic == p.Anthropic && existing.Chat == p.Chat && existing.Responses == p.Responses && existing.Off == p.Off && slices.Equal(existing.Models, p.Models) {
			if existing.Key == key {
				return false, nil
			}
			for _, account := range existing.Keys {
				if account.Key == key {
					return false, nil
				}
			}
		}
	}
	if err := Save(p); err != nil {
		return false, err
	}
	return true, nil
}
