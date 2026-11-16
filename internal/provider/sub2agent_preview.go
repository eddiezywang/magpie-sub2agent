package provider

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/yetone/magpie/internal/distribution"
)

// LegacySupplierPreview never reads credentials or changes either application.
type LegacySupplierPreview struct {
	Found     bool                 `json:"found"`
	Complete  bool                 `json:"complete"`
	Dismissed bool                 `json:"dismissed"`
	Attempted bool                 `json:"attempted"`
	Sources   []LegacySupplierItem `json:"sources"`
}

type LegacySupplierItem struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Icon     string `json:"icon"`
	Imported bool   `json:"imported"`
	Outcome  string `json:"outcome,omitempty"`
}

func legacySourceID(s legacySub2AgentSource) string {
	sum := sha256.Sum256([]byte(s.Kind + "\x00" + s.Provider + "\x00" + s.ID))
	return hex.EncodeToString(sum[:16])
}

func LegacySub2AgentPreview() (LegacySupplierPreview, error) {
	if !distribution.Internal {
		return LegacySupplierPreview{}, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return LegacySupplierPreview{}, errors.New("无法确定旧版认证目录")
	}
	return legacySub2AgentPreview(filepath.Join(home, ".sub2agent", "data"))
}

func legacySub2AgentPreview(root string) (LegacySupplierPreview, error) {
	out := LegacySupplierPreview{Sources: []LegacySupplierItem{}}
	var old struct {
		Version      int               `json:"version"`
		AuthProfiles []json.RawMessage `json:"auth_profiles"`
		Desktop      struct {
			Sources []legacySub2AgentSource `json:"sources"`
		} `json:"desktop"`
	}
	if err := readLegacyJSON(filepath.Join(root, "proxy.json"), &old); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return out, nil
		}
		return out, errors.New("旧版配置无法读取，请检查后重试")
	}
	if old.Version != 1 {
		return out, errors.New("旧版配置版本无法识别")
	}
	if len(old.Desktop.Sources) == 0 && len(old.AuthProfiles) > 0 {
		return out, errors.New("旧版仅包含早期账号数据，无法自动转换，请重新登录供应商")
	}
	if !legacySuppliersValid(old.Desktop.Sources) {
		return out, errors.New("旧版供应商来源编号缺失或重复")
	}
	out.Found = true
	var dismissed struct {
		Dismissed *bool `json:"dismissed"`
	}
	if err := readLegacyJSON(filepath.Join(filepath.Dir(Path()), "sub2agent-import-dismissed.json"), &dismissed); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return out, errors.New("导入提示状态无法读取")
		}
	} else if dismissed.Dismissed == nil {
		return out, errors.New("导入提示状态无效")
	} else {
		out.Dismissed = *dismissed.Dismissed
	}
	var complete struct {
		Complete *bool `json:"complete"`
	}
	if err := readLegacyJSON(filepath.Join(filepath.Dir(Path()), "sub2agent-import-complete.json"), &complete); err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return out, errors.New("导入完成标记无法读取")
		}
	} else if complete.Complete == nil {
		return out, errors.New("导入完成标记无效")
	} else {
		out.Complete = *complete.Complete
	}
	imported := map[string]bool{}
	if err := readLegacyJSON(filepath.Join(filepath.Dir(Path()), "sub2agent-auth-import.json"), &imported); err != nil && !errors.Is(err, os.ErrNotExist) {
		return out, errors.New("导入记录无法读取")
	}
	if imported == nil {
		return out, errors.New("导入记录无效")
	}
	// Earlier releases recorded successful sources without a global completion
	// marker. They are already handled; unresolved sources remain manually retryable.
	for _, done := range imported {
		if done {
			out.Attempted = true
			break
		}
	}
	var attempt struct {
		Attempted bool `json:"attempted"`
	}
	if err := readLegacyJSON(filepath.Join(filepath.Dir(Path()), "sub2agent-import-attempted.json"), &attempt); err != nil && !errors.Is(err, os.ErrNotExist) {
		return out, errors.New("导入尝试记录无法读取")
	}
	out.Attempted = out.Attempted || attempt.Attempted
	outcomes := map[string]string{}
	if err := readLegacyJSON(filepath.Join(filepath.Dir(Path()), "sub2agent-import-outcomes.json"), &outcomes); err != nil && !errors.Is(err, os.ErrNotExist) {
		return out, errors.New("导入结果记录无法读取")
	}
	if outcomes == nil {
		return out, errors.New("导入结果记录无效")
	}
	for _, original := range old.Desktop.Sources {
		s := normalizeLegacySupplier(original)
		name, icon := s.Name, "generic"
		if name == "" {
			name = "Sub2Agent 来源"
		}
		switch s.Provider {
		case "workbuddy":
			icon = "workbuddy-color"
		case "codebuddy":
			icon = "codebuddy-color"
		case "trae":
			icon = "trae"
		}
		if s.Kind == "endpoint" {
			if knownCodingPlanEndpoint(s.Endpoint.Base) {
				name, icon = "TIG-Coding-Plan", codingPlanPreset.Icon
			}
			if knownCIBEndpoint(s.Endpoint.Base) {
				name, icon = zhtPreset.Name, zhtPreset.Icon
			}
		}
		id := legacySourceID(s)
		out.Sources = append(out.Sources, LegacySupplierItem{ID: s.ID, Name: name, Kind: s.Kind, Icon: icon, Imported: imported[id], Outcome: outcomes[id]})
	}
	return out, nil
}

// DismissLegacySub2AgentImport suppresses automatic prompts; manual import remains available.
func DismissLegacySub2AgentImport() error {
	if !distribution.Internal {
		return errors.New("旧版导入不可用")
	}
	legacyImportMu.Lock()
	defer legacyImportMu.Unlock()
	return writePrivate(filepath.Join(filepath.Dir(Path()), "sub2agent-import-dismissed.json"), []byte("{\"dismissed\":true}\n"))
}

// Only the documented CIB origin and API bases identify this preset.
func knownCIBEndpoint(raw string) bool {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Scheme != "http" && u.Scheme != "https") || u.Host != "10.32.33.46:11288" {
		return false
	}
	switch strings.TrimRight(u.Path, "/") {
	case "/efllmas-agw/anthropicproxy", "/efllmas-agw/anthropicproxy/v1/messages", "/efllmas-agw/v1", "/efllmas-agw/v1/chat/completions", "/efllmas-agw/v1/responses":
		return true
	}
	return false
}
