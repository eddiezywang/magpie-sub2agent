package provider

import (
	_ "embed"
	"runtime"
)

// The old Sub2Agent desktop app pinned the WorkBuddy enterprise names to the
// office gateway in the system hosts file before every WorkBuddy sign-in
// (its desktop/src-tauri/src/workbuddy-hosts.ps1). The intranet distribution
// signs in through its plugins on machines that never ran that app, so the
// same script runs here first: without it the plugin's login fetch dies on a
// name office DNS cannot resolve, and the sheet says the sign-in service is
// unreachable. StartPluginSignInWith is the one door every sign-in takes,
// the GUI's and the command line's alike.
//
//go:embed workbuddy_hosts.ps1
var workBuddyHostsScript string

// workBuddyHostsProviders are the intranet plugins whose sign-in and API
// calls go through the names the script pins (copilot.tencent.com,
// www.workbuddy.cn). The old app ran the script at its WorkBuddy sign-in
// only; the script still rewrites the codebuddy names, because the same
// office gateway fronts them.
var workBuddyHostsProviders = map[string]bool{
	"sub2agent-workbuddy":     true,
	"sub2agent-workbuddy-cib": true,
}

// prepareWorkBuddyHosts pins those names to the office gateway before a
// sign-in starts, Windows only, as the old app did. Every other provider,
// and every non-Windows machine, has nothing to do.
func prepareWorkBuddyHosts(id string) error {
	if runtime.GOOS != "windows" {
		return nil
	}
	if !workBuddyHostsProviders[id] && !workBuddyHostsProviders[PluginID(id)] {
		return nil
	}
	return runWorkBuddyHostsScript()
}
