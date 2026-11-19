// Package distribution defines the separately built internal distribution.
package distribution

const Base = "http://172.21.0.177:18989"
const Market = Base + "/magpie/plugins/registry.json"
const Registry = Base + "/npm"
const Dist = Base + "/magpie/plugins/dist"
const AppFeed = Base + "/sub2agent/releases/latest.json"
const AppMirror = "http://uat.rcrai.weoa.com/wemail/sub2agent/releases"
const AppPublicMirror = "http://124.220.199.224:8899/sub2agent/releases"

// NPMRegistry is the office npm registry the agents' CLIs are installed
// from and their newest versions read from, npm's own the fallback for
// when it doesn't answer. The plugins' registry stays Registry, the
// release mirror this distribution serves itself.
const NPMRegistry = "http://wnpm.weoa.com:8001"

// Removed are features absent from the internal distribution, even when an
// imported configuration used to enable them.
var Removed = []string{"library", "middleware", "otel", "redact", "search", "tools", "warmups"}
