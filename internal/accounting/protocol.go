// Package accounting exports numeric usage independently of model traffic.
package accounting

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"net/url"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/yetone/magpie/internal/usage"
)

const UsageSchema = "sub2agent-usage/2"

// Identity is shared by both data planes. Username is a display label, not
// proof of server-side ownership. Go clients never pretend to run Node.
type Identity struct {
	InstallID string `json:"install_id"`
	Username  string `json:"username"`
}

// LegacyEvent retains the original single-object POST /events envelope.
// Usage deltas here measure runtime; token billing uses UsageEvent only.
type LegacyEvent struct {
	Identity
	Event          string    `json:"event"`
	Timestamp      time.Time `json:"timestamp"`
	Argv           []string  `json:"argv"`
	EntryMode      string    `json:"entry_mode"`
	Platform       string    `json:"platform"`
	Arch           string    `json:"arch"`
	NodeVersion    string    `json:"node_version"`
	AppVersion     string    `json:"app_version"`
	RuntimeVersion string    `json:"runtime_version"`
	ID             string    `json:"id"`
}

func Legacy(id Identity, eventID, event, version string, at time.Time, argv []string) (LegacyEvent, error) {
	switch event {
	case "process_start", "app_start", "desktop_app_start", "desktop_app_quit", "desktop_proxy_start", "desktop_proxy_stop", "desktop_proxy_usage_flushed", "desktop_operation_failed":
	default:
		return LegacyEvent{}, fmt.Errorf("unsupported legacy event")
	}
	return LegacyEvent{Identity: id, Event: event, ID: eventID, Timestamp: at.UTC(), Argv: safeArgv(argv),
		EntryMode: "desktop", Platform: legacyPlatform(runtime.GOOS), Arch: legacyArch(runtime.GOARCH),
		AppVersion: version, RuntimeVersion: runtime.Version()}, nil
}

func legacyPlatform(s string) string {
	if s == "windows" {
		return "win32"
	}
	return s
}
func legacyArch(s string) string {
	if s == "amd64" {
		return "x64"
	}
	if s == "386" {
		return "ia32"
	}
	return s
}

// Do not forward executable paths, arbitrary argv, error messages or URLs.
func safeArgv(argv []string) []string {
	out := []string{}
	for _, arg := range argv {
		key, value, ok := strings.Cut(strings.TrimPrefix(arg, "--"), "=")
		if !ok || !strings.HasPrefix(arg, "--") {
			continue
		}
		switch key {
		case "proxy-usage-ms", "proxy-uptime-ms", "proxy-total-tokens":
			n, err := strconv.ParseUint(value, 10, 53)
			if err == nil {
				out = append(out, "--"+key+"="+strconv.FormatUint(n, 10))
			}
		case "proxy-flush-reason":
			switch value {
			case "interval", "stop", "quit", "shutdown", "disabled":
				out = append(out, arg)
			}
		}
	}
	return out
}

// UsageEvent is an allowlist, never a serialization of the whole Record:
// Record can contain prompts, paths, account names and raw error messages.
type UsageEvent struct {
	ID               string    `json:"id"`
	Timestamp        time.Time `json:"ts"`
	LogicalRequestID string    `json:"logical_request_id,omitempty"`
	Agent            string    `json:"agent"`
	Provider         string    `json:"provider"`
	Model            string    `json:"model"`
	RequestedModel   string    `json:"requested_model,omitempty"`
	ServedModel      string    `json:"served_model,omitempty"`
	Session          string    `json:"session,omitempty"`
	Upstream         string    `json:"upstream,omitempty"`
	Input            int       `json:"input_tokens"`
	Output           int       `json:"output_tokens"`
	CacheRead        int       `json:"cache_read_tokens"`
	CacheWrite       int       `json:"cache_write_tokens"`
	CacheWrite1h     int       `json:"cache_write_1h_tokens"`
	CacheUnknown     bool      `json:"cache_unknown"`
	Reasoning        int       `json:"reasoning_tokens"`
	Duration         int64     `json:"duration_ms"`
	TTFT             int64     `json:"ttft_ms"`
	Status           int       `json:"status_code"`
	Outcome          string    `json:"outcome"`
	Tries            int       `json:"tries"`
	HandedOn         bool      `json:"handed_on"`
	Credits          *float64  `json:"credits,omitempty"`
	OwnCost          *float64  `json:"own_cost_usd,omitempty"`
	UsageSource      string    `json:"usage_source"`
}

type Batch struct {
	Schema string `json:"schema"`
	Identity
	Events []UsageEvent `json:"events"`
}

func opaque(key, value string) string {
	if value == "" {
		return ""
	}
	h := hmac.New(sha256.New, []byte(key))
	h.Write([]byte(value))
	return hex.EncodeToString(h.Sum(nil))[:32]
}

func FromRecord(r usage.Record, installID, runID, eventID string) (UsageEvent, error) {
	if r.IsProbe() || r.IsRejected() || r.Source != "" || r.Computer != "" {
		return UsageEvent{}, fmt.Errorf("not a local gateway usage record")
	}
	if r.Time.IsZero() || eventID == "" || installID == "" || runID == "" {
		return UsageEvent{}, fmt.Errorf("missing usage identity or time")
	}
	for _, n := range []int64{int64(r.Input), int64(r.Output), int64(r.CacheRead), int64(r.CacheWrite), int64(r.CacheWrite1h), int64(r.Reasoning), r.Millis, r.TTFT} {
		if n < 0 || n > 1<<53-1 {
			return UsageEvent{}, fmt.Errorf("invalid usage counter")
		}
	}
	if r.CacheWrite1h > r.CacheWrite {
		return UsageEvent{}, fmt.Errorf("1h writes exceed total cache writes")
	}
	for _, n := range []*float64{r.Credits, r.OwnCost} {
		if n != nil && (math.IsNaN(*n) || math.IsInf(*n, 0) || *n < 0) {
			return UsageEvent{}, fmt.Errorf("invalid observed cost")
		}
	}
	for _, s := range []string{r.Agent, r.Provider, r.Model, r.Requested, r.Served} {
		if len(s) > 256 || strings.ContainsAny(s, "\r\n\t") || strings.Contains(s, "://") {
			return UsageEvent{}, fmt.Errorf("invalid usage identifier")
		}
	}
	outcome := "success"
	if r.Canceled() {
		outcome = "aborted"
	} else if r.Failed() {
		outcome = "error"
	}
	logical := ""
	if r.RouteID != 0 {
		logical = opaque(installID, runID+":"+strconv.FormatInt(r.RouteID, 10))
	}
	return UsageEvent{ID: eventID, Timestamp: r.Time.UTC(), LogicalRequestID: logical, Agent: r.Agent,
		Provider: r.Provider, Model: r.Model, RequestedModel: r.Requested, ServedModel: r.Served,
		Session: opaque(installID, r.Session), Upstream: hostname(r.Host), Input: r.Input, Output: r.Output,
		CacheRead: r.CacheRead, CacheWrite: r.CacheWrite, CacheWrite1h: r.CacheWrite1h, CacheUnknown: r.CacheUnknown,
		Reasoning: r.Reasoning, Duration: r.Millis, TTFT: r.TTFT, Status: r.Status, Outcome: outcome,
		Tries: r.Tries, HandedOn: r.HandedOn, Credits: r.Credits, OwnCost: r.OwnCost, UsageSource: "gateway"}, nil
}

func hostname(s string) string {
	if !strings.Contains(s, "://") {
		s = "https://" + s
	}
	u, err := url.Parse(s)
	if err != nil {
		return ""
	}
	return u.Hostname()
}
