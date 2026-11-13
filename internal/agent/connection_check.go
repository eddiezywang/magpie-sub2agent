package agent

import (
	"net/url"
	"strings"

	"github.com/yetone/magpie/internal/edit"
)

// ConnectionCheck describes local configuration, not a successful inference.
// Reading it never adopts, syncs, or rewrites an agent's configuration.
type ConnectionCheck struct {
	Status  string `json:"status"`
	Managed bool   `json:"managed"`
	Path    string `json:"path"`
}

func CheckConnection(a *Agent, gateway string) ConnectionCheck {
	out := ConnectionCheck{Status: "disconnected", Path: a.Path}
	if a.Wired() {
		out.Status, out.Managed = "configured", true
		return out
	}
	if a.Routed != nil && a.Routed() {
		out.Status = "configured"
		return out
	}
	// Legacy Codex used a custom provider name. Inspect the selected table,
	// not every table: an unused local provider is not a configured connection.
	if a.ID == "codex" || strings.HasPrefix(a.ID, "codex-") {
		if _, err := edit.TOMLTables(a.Path); err != nil {
			out.Status = "unknown"
			return out
		}
		selected, _ := edit.GetTOMLTop(a.Path, "model_provider")
		base, _ := edit.GetTOMLTop(a.Path, "openai_base_url")
		if selected != "" && selected != "openai" {
			table, err := edit.GetTOMLTable(a.Path, "model_providers."+selected)
			if err != nil {
				out.Status = "unknown"
				return out
			}
			base = table["base_url"]
		}
		if sameLocalGateway(base, gateway) {
			out.Status = "configured"
		}
	}
	return out
}

func sameLocalGateway(base, gateway string) bool {
	a, err := url.Parse(strings.TrimSpace(base))
	if err != nil || a.User != nil || a.RawQuery != "" || a.Fragment != "" {
		return false
	}
	b, err := url.Parse(gateway)
	if err != nil || a.Scheme != b.Scheme || a.Port() != b.Port() {
		return false
	}
	loopback := func(host string) bool { return host == "localhost" || host == "127.0.0.1" || host == "::1" }
	if a.Hostname() != b.Hostname() && !(loopback(a.Hostname()) && loopback(b.Hostname())) {
		return false
	}
	return strings.TrimRight(a.Path, "/") == strings.TrimRight(b.Path, "/") || strings.TrimRight(a.Path, "/") == strings.TrimRight(b.Path, "/")+"/v1"
}
