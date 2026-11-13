# Sub2Agent accounting and legacy telemetry

`internal/accounting/protocol.go` defines two independent data planes.
Legacy telemetry preserves the original single-object `/events` envelope,
event names and Node platform spellings (`win32`, `x64`), with a Go runtime
version in its own additive field. It does not invent a Node version.
Only numeric uptime/token counters and enumerated flush reasons enter argv;
command lines, paths, arbitrary messages and credentials are never forwarded.

New gateway usage is aggregated in memory by completion minute, agent, provider,
actual model and provenance, observed service tier, classification-rule revision
and context tier. `summary.go` defines non-overlapping cache counters, attempt
outcomes, final-attempt request counts and sum/sample performance counters.
Reasoning stays a subset of output. Unknown cache usage and zero-token calls
remain explicit; Record cannot distinguish missing token usage from genuine zero.
Only gateway records enter this plane: probes, local rejections, synced and
independently reported rows are excluded. Session-reading consent is unchanged.

The transport schema is `sub2agent-usage/3`, with `summaries` rather than per-request
`events`. Its shared identity includes **username and install_id**. Username comes
from USERNAME/USER, with unknown as a last resort; collectors must keep unknown
users isolated by installation until mapped. Server-side identity association
allows multi-device user reports; a name is not proof of ownership. Each immutable
summary delta has a stable ID, UTC minute and bounded groups. Multiple deltas for
one minute are added, not overwritten. `(install_id, id)` deduplicates retries.
No request IDs, sessions, bodies, accounts, raw errors or client prices enter v3.

`rules.go` reads `/usage/aggregation-rules`, validates and atomically caches its
last valid immutable revision. It contains provider/model/service-tier matches
and context boundaries, never prices. Rules refresh every five minutes on the
HTTP worker; a failure retains cached rules. Missing or incomplete classifications
are unclassified, never silently billed as base/free. Changes to price amounts
can reprice aggregates; changes to tier boundaries cannot reconstruct old calls.
See the [minute-summary contract](../proposals/minute-usage.md) for exact semantics.

`runtime.go` seals elapsed UTC minutes independently of HTTP delivery. Requests
only update bounded in-memory counters; current-minute usage can be lost on an
abrupt exit, as authorized. Normal stop seals a partial minute without HTTP.
Frozen summaries enter the dedicated 20 MiB durable outbox (`queue.go`) only once
per packet, with sync before atomic rename; failed puts keep stable frozen IDs
in memory. The total memory budget is 1024 groups, active and frozen combined.
When exhausted, new groups are refused and dropped_calls increases; queue and
collection failures remain observable. Local usage.jsonl/session retention is
unchanged by this transport optimization.

`sender.go` requires `/healthz` to advertise the exact schema before sending.
A single HTTP worker drains bounded batches, jitters delivery and exponentially
backs off usage failures from 30 seconds to five minutes. Minute sealing proceeds
while HTTP is hanging. Legacy opportunities continue during usage backoff.
Successful posts require `{ok:true,schema,accepted_ids:[],duplicate_ids:[]}`;
unknown or repeated acknowledgement IDs and count-only replies are refused.
Rejected IDs are moved to the bounded 20 MiB rejected archive before leaving
pending. No pending or rejected data is silently evicted when full. Restart keeps
packet identity and the username at collection time, even if the current login
changes. Pending historical v2 events remain a separate compatibility plane and
require explicit v2 support; new requests no longer create v2 events.

The intranet-only `accounting` built-in registers a no-body usage observer. Legacy
startup/shutdown and ten-minute uptime events retain their old names and single
POST shape, independently of usage summaries. The old endpoint has its original
300 ms timeout. Shutdown cancels HTTP; durable final events retry next launch.
A proxy restart is not an application quit. The native OnShutdown observer emits
one desktop_app_quit with uptime/token counters. Abrupt exits cannot emit it.
App start is once per process and data directory.

Plugins > Built-in exposes exactly one **Telemetry reporting / 埋点上报** plugin
switch. There is no settings form: aggregation intervals, protocol versions and
collector addresses are distribution internals. Enabling reporting collects both
application activity and minute usage summaries; disabling the plugin unregisters
both observers and pauses delivery while retaining sealed pending data. Minute
aggregation cannot be independently switched off or replaced with request events.
Transport capability negotiation remains internal and never selects a fallback
wire format for new records. Backend health/capability failure keeps data queued.

The accounting manifest's pure MigrateRow removes retired per-plane flags and
URLs from composed configuration and frontend metadata. An old legacyEnabled:false
becomes an explicit disabled plugin, preserving opt-out. A later explicit toggle
wins and persists the clean row. Old usageEnabled:false was a rollout setting and
no longer selects another reporting mode. CB_PROXY_TELEMETRY remains a whole-report
process opt-out; CB_PROXY_TELEMETRY_URL is ignored. Neither user configuration nor
environment variables replace the managed destinations. The empty schema rejects
retired keys submitted through the settings API. No collector URL, internal IP,
minute interval or protocol requirements are rendered in the reporting controls.

telemetry.json preserves installation identity, independently of other apps.
accounting-status.json keeps internal queue counts, delivery failures, cached rule
revision, memory groups and dropped-call counts without credentials or event bodies.

Server implementation is tracked in `services/usage-server`. It accepts v3
summaries with explicit per-ID durable acknowledgements and preserves the old
telemetry/report endpoints. Summaries use append-only, fsynced daily JSONL;
conflicting IDs are rejected, torn tails preserved, complete corrupt rows fail
startup. Reports sum counter weights directly without recreating requests.
Username queries aggregate devices; install-ID queries remain separate and
unknown usernames never merge devices.

`billing-policy.json` on the server owns immutable revisions, context rules,
WorkBuddy MaaS point coefficients, promotion expiry and China weekday 14:00–18:00
GLM plan accounting factors. POINTS, PLAN_TOKENS and USD are separate currencies;
no coefficient is presented as a dollar price. Flat rates require no context
classification; request-size tiered minute summaries without recoverable context
remain unpriced. API-equivalent costs use a server-side snapshot exported through
the desktop's `provider.MakerPrice`, independently of enterprise point accounting.
Legacy provider IDs do not prevent model-name pricing. Exact model overrides take
precedence over recognized deployment suffix aliases; arbitrary prefix matches
are not accepted. Administrator prices take precedence over the catalog snapshot.
Normal reports
include a billing breakdown as well as their existing JSON/SVG/PNG shape.
Receipt images identify the username and show unpriced usage as pending pricing,
never as zero dollars. Points and plan-token amounts retain their own units;
mixed currencies are itemized, not summed. The primary receipt shows API-equivalent
CNY at the dated server-maintained `report-currency.json` exchange rate. Its
authenticated `/admin/report-currency` API updates that reference. Original USD
cost fields and enterprise POINTS/PLAN_TOKENS remain separate. These usage reports
are not settlement invoices. The original receipt fonts are JetBrains Mono and
Noto Sans CJK SC; font files stay in server assets, outside the desktop binary.
Admin policy edits require the existing admin Bearer token. Clients only receive
classification boundaries, with exact/trailing-wildcard deployment matching;
they contain no billing amounts or quota-multiplication rule.
Deployment status and real production verification are recorded separately.
Run `go test ./internal/accounting`. No tests reach a real telemetry endpoint.

Migration design: [minute-summary contract](../proposals/minute-usage.md), which supersedes the per-request transport in the older [server billing proposal](../proposals/server-billing.md).
