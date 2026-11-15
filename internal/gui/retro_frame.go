package gui

import (
	"os"
	"runtime"

	"github.com/yetone/magpie/internal/distribution"
)

// The intranet desktop uses the integrated frame by default on Windows.
func retroMainFrame(goos string, internal bool, choice string) bool {
	return goos == "windows" && internal && choice != "0"
}

func retroMainFrameEnabled() bool {
	return retroMainFrame(runtime.GOOS, distribution.Internal, os.Getenv("SUB2AGENT_RETRO_FRAME"))
}
