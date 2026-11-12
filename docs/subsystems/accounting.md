# Sub2Agent accounting and legacy telemetry

`internal/accounting/protocol.go` defines two independent data planes.
Legacy telemetry preserves the original single-object `/events` envelope,
event names and Node platform spellings (`win32`, `x64`), with a Go runtime
version in its own additive field. It does not invent a Node version.
Only numeric uptime/token counters and enumerated flush reasons enter argv;
command lines, paths, arbitrary messages and credentials are never forwarded.

Usage events are explicit numeric projections of `usage.Record`, not JSON
copies. They retain handed-on attempt accounting, cache splits, actual models
and observed vendor charges. Every attempt has its own persistent event ID;
the logical route key is scoped by install and process-run IDs, since gateway
RouteID restarts. Sessions are install-scoped HMACs. Gateway-only collection
excludes probes, local rejections, synced rows and independently reported rows.
This does not read agent session files or change their consent.

The new schema is `sub2agent-usage/2`: legacy collectors must continue to
receive `/events` unchanged. Usage ingestion requires explicit v2 support;
an old count-only response must not be interpreted as per-event acknowledgement.
Server changes must preserve v1 and old telemetry as independent adapters.

`queue.go` keeps bounded complete JSON events in a dedicated outbox, with
temporary writes renamed only after file sync. A restart preserves IDs and
identity; partial acknowledgements remove only named items. The two planes
can be cleared independently. `sender.go` preserves the old single-event
POST and `{ok:true}` response, never follows redirects, and keeps failures
queued. Usage delivery first requires `/healthz` to advertise
`usage_schemas: ["sub2agent-usage/2"]`; successful posts must return
`{ok:true,schema:"sub2agent-usage/2",accepted_ids:[],duplicate_ids:[]}`.
Count-only v1 responses and foreign/duplicate acknowledgement IDs are refused.
`rejected_ids` are validated against the sent batch and moved to the bounded
local `accounting-outbox/rejected` archive before leaving pending. If archival
fails, pending events remain available for retry. Neither pending nor rejected
events are silently evicted when their respective 20 MiB limits are reached.

The intranet-only `accounting` built-in registers a no-body usage observer.
It queues gateway records synchronously to local disk; HTTP runs separately,
every 30 seconds. Shutdown cancels HTTP and persists final lifecycle events
for the next run. The old endpoint has its original 300 ms request timeout.
Start/stop and ten-minute duration flushes retain the old event names. A proxy
restart is not reported as an application quit; abrupt exits cannot produce a
final duration event. App start is emitted once per process and data directory.

Plugins > Built-in > 用量上报 exposes two independent switches and endpoints.
Old telemetry is enabled by default, with `CB_PROXY_TELEMETRY` and
`CB_PROXY_TELEMETRY_URL` overrides retained. New request reporting defaults off
until the existing server implements the negotiated v2 contract. Settings
changes dispose the old sender before opening its replacement, without an
application restart. Turning a plane off clears that plane's pending queue;
turning the whole built-in off pauses collection and delivery, retaining the
queue for re-enabling. The rejected archive remains available for diagnosis.
`telemetry.json` preserves this distribution's install identity; it never reads
another application's data. `accounting-status.json` records local queue counts,
last delivery and failure information, without credentials or event bodies.

Current implementation stage: client protocol, durable delivery and runtime
integration. Server pricing, ingestion adapters and report endpoints still need
the existing usage-server source; this client does not calculate server bills.
Run `go test ./internal/accounting`. No tests reach a real telemetry endpoint.

Migration design: [server billing proposal](../proposals/server-billing.md).
