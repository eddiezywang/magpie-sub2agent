//go:build intranet

package gui

import "testing"

func TestInternalWebKeepsLocalSessionPermissionGate(t *testing.T) {
	was := webPage.Swap(true)
	defer webPage.Store(was)
	old := WebGateway.Swap(true)
	defer WebGateway.Store(old)
	if ownSessionsOff() {
		t.Fatal("internal browser gateway mode hid local sessions independently of read permissions")
	}
}
