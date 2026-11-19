//go:build windows

package provider

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"time"
)

// workBuddyHostsTimeout bounds the script's gateway probe (2s a candidate)
// and the UAC prompt the elevation waits behind. The old desktop app waited
// unbounded; a bound turns a forgotten prompt into a retryable failure.
const workBuddyHostsTimeout = 3 * time.Minute

// runWorkBuddyHostsScript passes the script as one -Command argument, the
// way the old app did, so its self-elevation reads itself back from the
// command line and relaunches elevated without a script file on disk.
func runWorkBuddyHostsScript() error {
	ctx, cancel := context.WithTimeout(context.Background(), workBuddyHostsTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "powershell.exe",
		"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", workBuddyHostsScript)
	// CREATE_NO_WINDOW: a sign-in must not flash a console.
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	if err == nil {
		return nil
	}
	if detail := strings.TrimSpace(out.String()); detail != "" {
		err = fmt.Errorf("%w: %s", err, detail)
	}
	return fmt.Errorf("WorkBuddy 企业网络配置失败，请连接办公网络或 VDI，并允许 Windows 管理员授权：%w", err)
}
