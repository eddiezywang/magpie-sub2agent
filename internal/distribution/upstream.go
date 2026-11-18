//go:build !intranet

package distribution

const Internal = false

const DefaultVersion = "dev"

const Name = "magpie"
const DisplayName = "Magpie"
const GatewayKeyPrefix = "sk-magpie-key-"
const AgentRouteNote = "via magpie"
const DataDir = "magpie"
const AppID = "ai.usemagpie.app"
const GatewayPort = 3425
const WebPort = 3430
const WebAddr = "127.0.0.1:3430"
