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

Plugins > Built-in > 用量上报 exposes two independent switches and endpoints.
Old telemetry is enabled by default, with `CB_PROXY_TELEMETRY` and
`CB_PROXY_TELEMETRY_URL` overrides retained. New minute reporting defaults off
until the existing server implements the negotiated v3 contract. Settings
changes dispose the old sender before opening its replacement, without an
application restart. Turning a plane off clears that plane's pending queue;
turning the whole built-in off pauses collection and delivery, retaining the
queue for re-enabling. The rejected archive remains available for diagnosis.
`telemetry.json` preserves this distribution's install identity; it never reads
another application's data. `accounting-status.json` records local queue counts,
last delivery, cached rule revision, memory groups and dropped-call counts, without credentials or event bodies.

Current implementation stage: client protocol, durable delivery and runtime
integration. Server pricing, ingestion adapters and report endpoints still need
the existing usage-server source; this client does not calculate server bills.
Run `go test ./internal/accounting`. No tests reach a real telemetry endpoint.

Migration design: [minute-summary contract](../proposals/minute-usage.md), which supersedes the per-request transport in the older [server billing proposal](../proposals/server-billing.md).
