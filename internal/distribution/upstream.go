//go:build !intranet

package distribution

const Internal = false

const Name = "magpie"
const DataDir = "magpie"
const AppID = "ai.usemagpie.app"
const GatewayPort = 3425
const WebPort = 3430
const WebAddr = "127.0.0.1:3430"
