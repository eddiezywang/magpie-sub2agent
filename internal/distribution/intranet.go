//go:build intranet

package distribution

const Internal = true

const DefaultVersion = "1.0.0-beta.14"

const Name = "sub2agent"
const DisplayName = "Sub2Agent"
const GatewayKeyPrefix = "sk-sub2agent-"
const AgentRouteNote = "via Sub2Agent"
const DataDir = "sub2agent"
const AppID = "local.sub2agent"
const GatewayPort = 8989
const WebPort = 8990
const WebAddr = "127.0.0.1:8990"
