package sub2agent

import (
	_ "embed"
	"encoding/json"
)

//go:embed workbuddy-cib-catalog.json
var workBuddyCIBCatalog []byte

type RateReference struct {
	Model       string  `json:"model"`
	Coefficient float64 `json:"coefficient"`
	Source      string  `json:"source"`
}

// WorkBuddyCIBRateReferences lists the plugin's source catalog for display.
func WorkBuddyCIBRateReferences() []RateReference {
	var entries [][3]json.RawMessage
	if err := json.Unmarshal(workBuddyCIBCatalog, &entries); err != nil {
		return nil
	}
	out := make([]RateReference, 0, len(entries))
	for _, entry := range entries {
		ref := RateReference{Source: "Reference from provider catalog"}
		if json.Unmarshal(entry[0], &ref.Model) == nil && json.Unmarshal(entry[2], &ref.Coefficient) == nil {
			out = append(out, ref)
		}
	}
	return out
}
