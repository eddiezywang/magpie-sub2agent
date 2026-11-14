package gateway

import (
	"testing"

	"github.com/yetone/magpie/internal/provider"
)

func TestWorkBuddyRouteIdentity(t *testing.T) {
	fresh(t)
	const account = "00000000-1111-2222-3333-444444444444"
	p := provider.Provider{ID: "sub2agent-workbuddy", Name: "WorkBuddy 企业", Account: &provider.Account{Agent: "plugin", User: account}}
	w := weighed(candidate{p: p, model: "hy4free", rest: p.ID}, p, weighing{}, false, provider.Chat)
	if w.Kind != "account" || w.Icon != "workbuddy-color" || w.Name != p.Name || w.Who != account {
		t.Fatalf("WorkBuddy must retain account identity with its provider branding: %+v", w)
	}
	p.Icon = "custom-icon"
	if got := weighed(candidate{p: p}, p, weighing{}, false, provider.Chat).Icon; got != p.Icon {
		t.Fatalf("explicit provider icon replaced: %q", got)
	}
}
