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
Server-side rejections remain queued until a rejection archival path is added.

Current implementation stage: protocol, outbox and sender fixtures; not yet
registered with the runtime. Observer, lifecycle and activation follow.
Run `go test ./internal/accounting`. No tests reach a real telemetry endpoint.

Migration design: [server billing proposal](../proposals/server-billing.md).
