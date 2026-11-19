package provider

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// The gate covers exactly the intranet plugins whose sign-in and API calls
// the old desktop app's hosts entries served, and nothing else.
func TestWorkBuddyHostsProvidersAreTheIntranetWorkBuddies(t *testing.T) {
	for _, id := range []string{"sub2agent-workbuddy", "sub2agent-workbuddy-cib"} {
		if !workBuddyHostsProviders[id] {
			t.Errorf("%s is not covered by the hosts preparation", id)
		}
	}
	for _, id := range []string{"workbuddy", "workbuddy-ai", "sub2agent-codebuddy", "sub2agent-trae", "community-workbuddy"} {
		if workBuddyHostsProviders[id] {
			t.Errorf("%s must not run the hosts preparation", id)
		}
	}
}

// The script keeps the seams the port relies on: the marker its merge rule
// dedupes on, the six enterprise names, both office gateways, the self-test
// entry and the self-elevation that reads the script back from the command
// line.
func TestWorkBuddyHostsScriptKeepsItsSeams(t *testing.T) {
	for _, want := range []string{
		"# Sub2Agent WorkBuddy",
		"copilot.tencent.com", "www.codebuddy.cn", "www.workbuddy.cn",
		"download.codebuddy.cn", "static.codebuddy.cn", "assets.workbuddy.cn",
		"172.21.248.13", "172.21.248.17",
		"-SelfTest", "GetCommandLineArgs",
	} {
		if !strings.Contains(workBuddyHostsScript, want) {
			t.Errorf("workbuddy_hosts.ps1 lost %q", want)
		}
	}
}

// The merge logic runs where the script runs. The self-test exercises the
// merge, idempotency and gateway failover without touching the real hosts
// file or the network.
func TestWorkBuddyHostsScriptSelfTest(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("the script is Windows-only")
	}
	ps, err := exec.LookPath("powershell.exe")
	if err != nil {
		t.Skipf("no powershell.exe: %v", err)
	}
	script := filepath.Join(t.TempDir(), "workbuddy-hosts.ps1")
	if err := os.WriteFile(script, []byte(workBuddyHostsScript), 0o600); err != nil {
		t.Fatal(err)
	}
	out, err := exec.Command(ps, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-SelfTest").CombinedOutput()
	if err != nil {
		t.Fatalf("self-test failed: %v\n%s", err, out)
	}
	if !strings.Contains(string(out), "WorkBuddy hosts self-check passed") {
		t.Fatalf("self-test output lost its pass line:\n%s", out)
	}
}
