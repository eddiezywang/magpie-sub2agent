// Package distribution defines the separately built internal distribution.
package distribution

const Base = "http://172.21.0.177"
const Market = Base + "/magpie/plugins/registry.json"
const Registry = Base + "/npm"
const Dist = Base + "/magpie/plugins/dist"
const AppFeed = Base + "/sub2agent/releases/latest.json"

// Removed are features absent from the internal distribution, even when an
// imported configuration used to enable them.
var Removed = []string{"library", "middleware", "otel", "redact", "search", "tools", "warmups"}
