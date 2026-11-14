//go:build !nogui && intranet

package gui

import "embed"

// The internal app, window and tray share the pixel S used in the GUI header.
//
//go:embed pixelbrand/tray-44.png
var trayIcon []byte

// Internal builds do not play the upstream bird animation.
var trayFlap embed.FS

//go:embed pixelbrand/app.ico
var winTrayIcon []byte

//go:embed pixelbrand/app-1024.png
var appIconLarge []byte
