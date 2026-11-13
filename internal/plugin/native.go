package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// NativeProvider is the declaration of a packaged native-key adapter. The host
// still owns existing provider IDs, credentials, model picks and its editor.
type NativeProvider struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Anthropic string `json:"anthropic"`
	KeysURL   string `json:"keysUrl"`
	Website   string `json:"website"`
}

func AIEPAdapter() *NativeProvider {
	if shippedKind("@sub2agent/aiep") == "" {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(Target("@sub2agent/aiep"), "package.json"))
	if err != nil {
		return nil
	}
	var manifest struct {
		Magpie struct {
			Native *NativeProvider `json:"nativeProvider"`
		} `json:"magpie"`
	}
	if json.Unmarshal(data, &manifest) != nil || manifest.Magpie.Native == nil || manifest.Magpie.Native.ID != "aiep-coding-plan" {
		return nil
	}
	return manifest.Magpie.Native
}
