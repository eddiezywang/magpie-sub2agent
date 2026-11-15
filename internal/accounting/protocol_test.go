package accounting

import (
	"encoding/json"
	"github.com/yetone/magpie/internal/usage"
	"math"
	"strings"
	"testing"
	"time"
)

func TestLegacySingleEventRemainsNodeCompatible(t *testing.T) {
	e, err := Legacy(Identity{"install-1", "alice"}, "event-1", "desktop_proxy_usage_flushed", "test", time.Unix(1700000000, 0), []string{
		"C:/secret/config", "--api-key=SECRET", "--proxy-usage-ms=600000", "--proxy-flush-reason=interval", "--error-message=SECRET", "--proxy-total-tokens=-1"})
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(e)
	var got map[string]any
	json.Unmarshal(b, &got)
	for _, key := range []string{"event", "timestamp", "username", "install_id", "argv", "entry_mode", "platform", "arch", "node_version", "app_version"} {
		if _, ok := got[key]; !ok {
			t.Fatalf("missing old field %s", key)
		}
	}
	if got["event"] != "desktop_proxy_usage_flushed" || len(got["argv"].([]any)) != 2 || strings.Contains(string(b), "SECRET") {
		t.Fatalf("bad legacy envelope: %s", b)
	}
	if legacyPlatform("windows") != "win32" || legacyArch("amd64") != "x64" {
		t.Fatal("Node platform spelling changed")
	}
	if _, err := Legacy(Identity{}, "x", "invented_event", "", time.Now(), nil); err == nil {
		t.Fatal("invented lifecycle event accepted")
	}
}

func TestUsagePreservesAttemptsAndDropsPrivateFields(t *testing.T) {
	r := usage.Record{Time: time.Unix(1700000000, 0), RouteID: 12, Agent: "codex", Provider: "sub2agent-workbuddy", Model: "vendor-model", Requested: "group/default", Served: "actual-model",
		Input: 100, Output: 40, CacheRead: 200, CacheWrite: 80, CacheWrite1h: 20, Reasoning: 30, Status: 503, HandedOn: true, Tries: 1,
		Session: "PRIVATE-SESSION", BodyIn: "PRIVATE-PROMPT", BodyOut: "PRIVATE-REPLY", Error: "PRIVATE-ERROR", ProviderAccount: "PRIVATE-ACCOUNT",
		Host: "https://user:PRIVATE-TOKEN@vendor.example:443/private?token=PRIVATE-QUERY"}
	a, err := FromRecord(r, "install-1", "run-1", "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	r.Status = 200
	r.HandedOn = false
	r.Tries = 2
	b, err := FromRecord(r, "install-1", "run-1", "attempt-2")
	if err != nil {
		t.Fatal(err)
	}
	if a.ID == b.ID || a.LogicalRequestID != b.LogicalRequestID || !a.HandedOn || b.HandedOn || a.CacheWrite1h != 20 || a.Output != 40 {
		t.Fatal("attempt or token semantics lost")
	}
	bytes, _ := json.Marshal(a)
	if strings.Contains(string(bytes), "PRIVATE-") || a.Upstream != "vendor.example" {
		t.Fatalf("private data exported: %s", bytes)
	}
	c, _ := FromRecord(r, "install-1", "run-2", "attempt-3")
	if c.LogicalRequestID == b.LogicalRequestID {
		t.Fatal("route IDs collide across restarts")
	}
}

func TestUsageRejectsInvalidOrDuplicateSources(t *testing.T) {
	base := usage.Record{Time: time.Now(), Provider: "test", Model: "m", Status: 200}
	for _, change := range []func(*usage.Record){func(r *usage.Record) { r.Input = -1 }, func(r *usage.Record) { r.CacheWrite1h = 1 }, func(r *usage.Record) { r.Source = usage.SourceReported }, func(r *usage.Record) { r.Computer = "other" }, func(r *usage.Record) { r.Rejected = true }, func(r *usage.Record) { n := math.Inf(1); r.Credits = &n }} {
		r := base
		change(&r)
		if _, err := FromRecord(r, "i", "run", "event"); err == nil {
			t.Fatalf("accepted invalid record: %+v", r)
		}
	}
}
