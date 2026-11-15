package gui

import (
	"os"
	"runtime"

	"github.com/yetone/magpie/internal/distribution"
)

// Keep unverified frame behavior out of normal builds until desktop review.
func retroMainFrame(goos string, internal bool, choice string) bool {
	return goos == "windows" && internal && choice == "1"
}

func retroMainFrameEnabled() bool {
	return retroMainFrame(runtime.GOOS, distribution.Internal, os.Getenv("SUB2AGENT_RETRO_FRAME"))
}
