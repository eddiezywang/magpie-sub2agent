//go:build intranet

package gateway

import (
	"github.com/yetone/magpie/internal/provider"
	"net/http"
	"testing"
)

func TestEnterpriseCreditRefusalDoesNotRestUnconfirmedOtherPools(t *testing.T) {
	for _, id := range []string{"sub2agent-workbuddy", "sub2agent-workbuddy-cib"} {
		t.Run(id, func(t *testing.T) {
			fresh(t)
			c := candidate{p: provider.Provider{ID: id, Account: &provider.Account{Agent: "plugin", User: "fixture"}}, model: "glm-5.3-maas", rest: id}
			r := New().restAfter(c, http.StatusTooManyRequests, http.Header{}, []byte(wbExhausted))
			if r.Key != c.restID() || r.Model != c.model || r.Why != failCredit {
				t.Fatalf("wrong credit scope: %+v", r)
			}
			if _, ok := restOf(c.restKey()); ok {
				t.Fatal("whole enterprise account rested")
			}
			other := c
			other.model = "hy4free"
			if _, ok := restOf(other.restID()); ok {
				t.Fatal("unconfirmed alternate pool rested")
			}
		})
	}
}
