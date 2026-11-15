//go:build !nogui && !intranet

package gui

import "embed"

//go:embed tray.png
var trayIcon []byte // black glyph, tinted by the macOS menu bar

// trayFlap is the bird beating its wing and flicking its tail, played on
// the tray icon when it is clicked (build/icon/gen.go tray-flap).
//
//go:embed trayflap/*.png
var trayFlap embed.FS

// winTrayIcon is the tile for Windows' tray, at each size it asks for
// (build/icon/gen.go win-ico): filling its square as the icons beside it
// do, where the Mac's tile with its clear margin looked a size smaller.
//
//go:embed icon-windows.ico
var winTrayIcon []byte

// The app's own icon: the Mac's Dock (which it replaces the bundle's .icns
// in, at up to 512pt), window icons and the about box. At 64px it was
// scaled up there and blurred.
//
//go:embed icon-1024.png
var appIconLarge []byte
