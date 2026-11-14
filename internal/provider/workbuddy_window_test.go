package provider

import (
	"github.com/yetone/magpie/internal/settings"
	"testing"
)

func TestWorkBuddyOperationalCompactWindow(t *testing.T) {
	mixed := func(string) (Group, []Member, bool) {
		return Group{}, []Member{{Provider: Provider{ID: "sub2agent-workbuddy"}, Model: "glm-5.3-flash-maas-tenant"}, {Provider: Provider{ID: "sub2agent-workbuddy"}, Model: "hy4free"}}, true
	}
	for _, id := range []string{"sub2agent-workbuddy/glm-5.3-flash-maas-tenant", "magpie/sub2agent-workbuddy/deepseek-v4-pro-maas[1m]", "group/mixed"} {
		e := Entry{ID: id, Context: 256000}
		if got := CompactFor(settings.Settings{}, e, mixed); got != 224000 {
			t.Fatalf("%s compact=%d", id, got)
		}
		if got := CompactFor(settings.Settings{CompactAt: 180000}, e, mixed); got != 0 {
			t.Fatal("explicit shared threshold must win")
		}
		if got := CompactFor(settings.Settings{FullContext: true}, e, mixed); got != 0 {
			t.Fatal("explicit full-window preference must win")
		}
	}
	for _, id := range []string{"other/glm-maas", "sub2agent-workbuddy/hy4free", "sub2agent-workbuddy/Deepseek-V4-Flash"} {
		if got := workBuddyCompactWindow(id, mixed); got != 0 {
			t.Fatalf("unrelated %s=%d", id, got)
		}
	}
	e := Entry{ID: "sub2agent-workbuddy/glm-maas", Context: 60000}
	if got := CompactFor(settings.Settings{}, e, mixed); got != 60000 {
		t.Fatal("small model must not grow")
	}
	e.WindowSet = true
	if got := CompactFor(settings.Settings{}, e, mixed); got != 60000 {
		t.Fatal("explicit window must win")
	}
	s := settings.Settings{ModelCompacts: map[string]int{"sub2agent-workbuddy/glm-maas": 48000}}
	if got := CompactFor(s, e, mixed); got != 48000 {
		t.Fatal("explicit model threshold must win")
	}
}
