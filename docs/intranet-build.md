# Internal offline build

This fork's `intranet` build tag selects a separate internal distribution;
ordinary upstream builds retain their original behavior. The executable keeps
the upstream provider UI, local gateway, routing, accounts, agent wiring and
local usage reporting. The portable package includes Bun, not WebView2.
Sessions is retained, including its navigation, assets, history consent,
read/search/resume/export interactions and gateway conversation projection.
Library remains removed. Retaining Sessions does not enable reading private
agent history until its existing consent setting permits it.

`internal/distribution` is the source of truth for internal service addresses,
removed built-in registrations and the resource download policy. The policy
applies to application resources and their redirects, not provider inference.
It permits the internal server and loopback test servers; it is not an OS-level
sandbox for arbitrary plugins, subprocesses or vendor authentication.

## Library removal

`plugins/all/intranet.go` does not register Library. Asset packing omits the
Library client, styles and translations. GUI library routes are not registered,
the CLI refuses library commands, startup Sync is a no-op, mutations are refused,
and Library init callbacks and the linked-file watcher do not start. Existing
agent files are not cleaned up or rewritten by this experimental distribution.
Shared library types remain where the upstream backup/profile dependencies
require them; this is not yet a complete source-level separation.
Shared switch styling belongs to app.css, because accounts, usage and built-in
plugin settings use these controls even when Library is absent.

## Plugin distribution

Directory, npm metadata, dist tarballs, README and icon endpoints are fixed to
172.21.0.177. Public discovery is disabled, and an unavailable directory yields
its internal cache or an empty list rather than the built-in community list.
Scoped user npm configuration cannot override metadata lookups. Network plugin
installation is deliberately refused until a curated complete-bundle protocol
exists; local plugin folders containing all dependencies remain supported.
`GET /api/plugins/listings` and the combined market response include a `market`
status: `online`, `cached` or `unavailable`, with `reason`, optional HTTP status,
check time and cache time. A healthy `{"plugins":[]}` is an empty directory;
timeout/refused/HTTP/invalid JSON failures are never represented as healthy
emptiness. Failed reads retain the last valid cache and retry at most once per
minute; the UI's Retry connection explicitly refreshes the directory. Error
details sent to the UI exclude raw network URLs and credentials. Discover keeps
offline import available and does not offer public npm/GitHub installation.
No server-side deployment is performed by this build.

## Build and verify

With Go 1.26.8 on PATH and the verified official Bun 1.4.2 baseline zip:

```powershell
./build/intranet.ps1 -BunArchive D:\path\bun-windows-x64-baseline-1.4.2.zip
go test -tags production,packedassets,intranet ./internal/distribution ./internal/plugin ./internal/gui -run 'TestAsset|TestIntranet' -count=1
```

The packer excludes removed modules' scripts/styles/translations and demo video
files, and removes their index references. `heic_decoder.go` is excluded by the
tag so the H.265 decoder dependency is absent. The build script creates a fresh
timestamped portable folder and zip, SHA-256 manifest and measured size report.
It never packages an existing data folder or deletes earlier build outputs.

The `MAGPIE_BUN` override may point at an existing absolute local executable for
tests. Otherwise the internal build uses `runtime/bun.exe` beside itself and
reports an error if it is missing; it never downloads a replacement.

Private CodeBuddy, WorkBuddy enterprise and Trae enterprise providers are built
from the authorized sibling Sub2Agent checkout (override with
`-Sub2AgentSource`). Its pinned Node dependencies must already be installed.
Generated implementations are excluded from Git; see
[provider ownership](subsystems/provider-plugins.md).

Limitations: real provider accounts remain unverified; WebView2 must be installed;
shared backend dependencies are not all pruned; production account and full
desktop UI validation are not covered by the package-size experiment.
