# Internal offline build

This fork's `intranet` build tag selects a separate internal distribution;
ordinary upstream builds retain their original behavior. The executable keeps
the upstream provider UI, local gateway, routing, accounts, agent wiring and
local usage reporting. The full portable package includes Bun, not WebView2.
`build/intranet.ps1 -WithoutBun` produces a light package: Windows x64 downloads
the pinned Bun from the managed internal npm mirror on first plugin startup,
then reuses the validated cache offline. Neither package includes WebView2.
`build/intranet.ps1 -SingleFile` additionally embeds the four private provider
baselines and license texts, distributes only the EXE, and keeps build metadata
outside the user archive. This mode does not require a Bun archive on the build
command line. Internal builds share `~/.sub2agent` and no longer ship a
`.portable` marker. Previous configuration directories are copied on first
use as described in [GUI app shell](subsystems/gui-shell.md).
Sessions is retained, including its navigation, assets, history consent,
read/search/resume/export interactions and gateway conversation projection.
Library remains removed. Retaining Sessions does not enable reading private
agent history until its existing consent setting permits it.

## Workspace verification

The intranet asset pack includes the workspace only in this distribution. It
shares the native Agent, Routing and Providers elements and existing settings;
it adds no independent routing preference. Throughput is an in-memory 180-second
output estimate, separate from Sessions and billing (see
[gateway sessions](subsystems/gateway-sessions.md#workspace-throughput-intranet)).
Returning to an earlier build removes the workspace UI; it does not undo Agent
model selections made through the native save API. Disconnect or select another
model through the retained Agent page to change those settings.

`build/workspace-launch.ps1 -BuildPath <fresh-portable-bundle>` starts an isolated
QA runtime on gateway 19893 and web 19894. It uses a dedicated HOME, APPDATA and
XDG directories, clears the Agent folder overrides and keeps the web sign-in key
in the local bundle's `qa-web-key.txt`; never publish that file or the logs.
Use a fresh QA bundle, not a real user's portable folder. The launcher does not
stop an existing process or take over its port.

`QA_RUNTIME=<bundle> node build/workspace-runtime.cjs` verifies native wiring,
group persistence/routing, throughput and retained pages against that runtime.
It writes synthetic Agent fixtures into the QA home and adds synthetic providers
and a template through the existing APIs. `build/workspace-acceptance.cjs` uses
packed assets selected by WORKSPACE_ASSETS and isolated synthetic APIs in both
browser engines; ARTIFACT_DIR selects its screenshot output. Keep screenshots
and sanitized result JSON separate from the runtime directory before publishing.

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

## Masking removal

The internal build also omits the `redact` registration, navigation, clients,
styles, translations, demos, masking records/preview APIs and local PII model
APIs. Masking-specific settings mutations return 404. Privacy retains sharing,
account visibility, agent sign-in discovery and Sessions' history consent.
Masking controls in provider, routing group and gateway key editors are hidden.
The primary masking settings renderer belongs to the redact plugin; it is no
longer loaded in this build. Intranet marketplace status is lazy loaded too,
keeping the core script size within its existing budget.

Existing settings and key policies are preserved on disk, but do not enable
request masking or download its model in this distribution. A gateway key
imported with forced masking therefore does not block requests for a missing
masker. Credential scrubbing in application logs remains independent and active.
Shared backend masking types are still compiled where upstream callers need them.

## Plugin distribution

Directory, npm metadata, dist tarballs, README and icon endpoints are fixed to
172.21.0.177. Public discovery is disabled, and an unavailable directory yields
its internal cache or an empty list rather than the built-in community list.
Scoped user npm configuration cannot override metadata lookups. Curated complete
ESM bundles can be installed from the internal catalog: mandatory SHA-256 and
byte count, bounded download, strict three-file ZIP layout, staged validation
and replacement, no install scripts or dependency downloads. Local complete
plugin folders remain supported for packages outside this v1 bundle format.
`GET /api/plugins/listings` and the combined market response include a `market`
status: `online`, `cached` or `unavailable`, with `reason`, optional HTTP status,
check time and cache time. A healthy `{"plugins":[]}` is an empty directory;
timeout/refused/HTTP/invalid JSON failures are never represented as healthy
emptiness. Failed reads retain the last valid cache and retry at most once per
minute; the UI's Retry connection explicitly refreshes the directory. Error
details sent to the UI exclude raw network URLs and credentials. Discover keeps
offline import available and does not offer public npm/GitHub installation.
The build does not modify servers. The separate
[market deployment kit](../deploy/plugin-market/README.zh-CN.md) provides the
read-only service, publisher, health/artifact checker, deployment and rollback.

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

## Workspace review builds

Workspace is internal-only. The packed index loads workspace-i18n.js,
workspace.js, workspace-throughput.js and workspace.css; upstream defaults and
the tray panel remain separate. Agent, Routing and Providers keep one native
DOM host each, including their normal dialogs and API writes. Sessions remains
available. Do not copy design-preview fixtures into a release or implement the
composition with an iframe.

The live meter is process memory, not a usage ledger: 180 complete one-second
buckets, five-second mean output token/s and independent peaks since the
process/series started. The conversion rate is fixed when output arrives;
unknown rates remain null. Provider/model/session dimensions cap at 128/512/256,
evict the least recently heard series, and mark truncation without changing the
total. GUI GET /api/gateway/throughput can read a different loopback owner via
GET /v1/magpie/throughput; unsupported/offline owners are unavailable, not idle.
The owner endpoint refuses remote or held-key access. Request text, credentials
and raw usage do not enter its response. Existing /api/speeds and Sessions'
120-second curves retain their original contract. See
[session statistics](subsystems/gateway-sessions.md#workspace-throughput-intranet).

For a native review, build a fresh timestamped portable folder, then run:

```powershell
./build/workspace-launch.ps1 -BuildPath D:\path\to\fresh-portable-folder
$env:QA_RUNTIME = 'D:\path\to\fresh-portable-folder'
node build/workspace-runtime.cjs
```

The launcher uses a private HOME/USERPROFILE/APPDATA/XDG inside that fresh folder,
clears Agent folder overrides, and uses local gateway/web ports 19893/19894.
The verifier requires Playwright and Chrome. It creates only synthetic providers
and test Agent configurations, checks native group saves and loopback streamed
output, and captures retained pages. Its qa-web-key.txt and redirected logs stay
local: never upload them, data/, qa-home/ or the whole runtime folder. The original
ZIP is created before verification and contains no QA configuration. Browser
fixture checks use build/workspace-acceptance.cjs against extracted packed assets
via WORKSPACE_ASSETS; those fixtures are never part of the packaged app.

Rollback uses a retained, checksum-verified portable bundle in a separate folder.
Close only the review process started from its recorded path/PID; do not stop a
user's existing gateway. Back up the review data before selecting another bundle
and keep data directories separate. The meter has no persistent migration to
reverse. Reverting application code requires rebuilding the complete embedded
asset bundle as well; replacing only workspace.js cannot update a packed EXE.
The current evidence and known failing checks are recorded in
[workspace verification](../openspec/changes/intranet-routing-workspace/verification.md).
