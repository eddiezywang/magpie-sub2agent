//go:build !windows

package provider

// runWorkBuddyHostsScript has nothing to do off Windows; prepareWorkBuddyHosts
// never reaches it there. It exists so the provider package builds everywhere.
func runWorkBuddyHostsScript() error { return nil }
