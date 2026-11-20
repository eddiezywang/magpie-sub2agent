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

The intranet Usage Overview shows a single panel for configured TIG, CIB
智汇通 API Key, WorkBuddy Enterprise and WorkBuddy CIB providers. The panel
provides Usage, Activity and Usage Details. The original gateway summary and
other subscription allowances stay below. Supplier charts read the current
gateway ledger, including cache reads and writes, and use the reader's time
zone for day boundaries. The activity grid distinguishes dates outside
retained history from zero-use dates. The cumulative Token card covers the
whole retained ledger. The cumulative chart follows the displayed calendar.
Usage Details uses hourly buckets for today and daily buckets for seven or
thirty days. Filtering models updates the displayed series and selected
subtotal. The selected period's total covers all its models.

CIB 智汇通 reports Token only, with K/M/B values for today, seven days,
thirty days, and all retained history. Its daily Token line supports seven
or thirty days. WorkBuddy Enterprise shows local MaaS estimates and upstream
per-request credits separately. WorkBuddy CIB shows its upstream allowance and
reset separately for every account. Catalog reference multipliers are
displayed independently of per-request credits.

See [the supplier ledger fold](../../internal/usage/supplier_usage.go),
[the Overview client](../../internal/gui/assets/plugins/usage/supplier-usage.js)
and [the Playwright fixtures](../../internal/gui/tests/usage-overview-fold.test.cjs).

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
The receipt uses the day-card forest-lake backdrop and paper layout with the blue
Sub2Agent mark and pixel agent/model icons. Its height grows with displayed
content; at most eight agents and five models per agent are shown, with a count
for omitted entries. The underlying report is not truncated. The total is an
API-price estimate, not a settlement.
Admin policy edits require the existing admin Bearer token. Aggregation rules
only expose classification boundaries. The separate routing catalog exposes
currency and reference coefficients for model selection and explanation, with
exact/trailing-wildcard deployment matching. Time-of-day billing factors remain
server-side; coefficients do not claim a remaining quota or settlement amount.
Deployment status and real production verification are recorded separately.
Run `go test ./internal/accounting`. No tests reach a real telemetry endpoint.

Migration design: [minute-summary contract](../proposals/minute-usage.md), which supersedes the per-request transport in the older [server billing proposal](../proposals/server-billing.md).


## Signed billing queries

`/users` and `/reports/<user>/{daily,weekly}.{json,svg,png}` require HMAC-SHA256 over the HTTP method, exact request target, millisecond timestamp and a 16-byte random nonce. The server rejects requests outside a five-minute clock window, bad signatures, replays and requests without a configured key; its bounded replay cache is shared by both listeners and resets on restart. `/healthz`, usage ingestion, aggregation rules, and legacy telemetry retain their prior contracts. Admin endpoints retain their separate admin token. The client obtains the key only at build time from an administrator-controlled file; the server reads the same key from a restricted file. The browser gets neither the key nor the upstream signature: `GET /api/accounting/report` proxies only the local OS user's daily or weekly report. An embedded shared key is extractable and does not establish user identity or protect against a user with access to an app binary; transport encryption and per-user authorization would be needed for stronger protection. See `internal/accounting/billing_auth.go` and `services/usage-server/src/billing-auth.js`.

On 2026-11-14 the signature verifier was deployed to the 0.177 usage service on ports 17890 and 17891. The signed client is available in release `0.1.3913-sub2agent.6` on the port 18989 release service. Verification on KF confirmed that unsigned report requests return 401 on both ports, while the released client reaches the report handler with a signed request for a nonexistent test user; no real report was read. Service health and the existing aggregation-rules endpoint remained available, and replayed signatures were rejected. Previous direct report links and clients without signing are no longer accepted. The prior server source is backed up on the host in `/opt/usage-server-backups/before-billing-auth-f6588ef.tgz`.

The usage server's `mail-preferences.js` stores a per-account boolean and
monotonic revision with an idempotent operation ID. A stale revision cannot
replace a newer choice; invalid or unreadable storage fails closed. The store
is exposed at the billing-signed GET/POST `/mail-preferences/{username}`
endpoint. Its identity is the existing OS username, not verified individual
identity; the shared billing key is not a per-user credential. The endpoint
does not send email. See
`services/usage-server/test/mail-preferences.test.js`.
The client-side `MailPreferences` state machine persists explicit choices and
an operation ID separately from telemetry, fetches the server revision before
its first write and retains offline choices. A stale revision is surfaced as a
conflict rather than silently overwriting another device. Its signed HTTP
transport uses the billing service and does not carry credentials to the page.
The desktop starts a retry worker on launch, refreshes the server value every 30 seconds, and exposes the setting in Settings. A failed sync is shown as pending; a conflict requires an explicit choice. Sending mail remains a future server feature.


## TIG Zhipu Coding Plan estimates

TIG and its legacy provider ID use the Zhipu Coding Plan schedule only for
explicit `-zp`, `-zp-openai` or `-openai-zp` deployment IDs. The policy maps GLM-5.2 and
5.1 to GLM-5.3 rates and GLM-5-Turbo and 4.7 to Flash rates, as the
[official plan documentation](https://docs.bigmodel.cn/cn/coding-plan/overview)
states. Input/cache hit/output coefficients are respectively 6.9/1.7/24 and
2.3/0.56/8 points per 10,000 tokens; weekdays 14:00–18:00 China time are
full price, all other times half. Cache writes use the input rate; unknown
cache breakdown is unpriced. `GLM_POINTS` stays separate from WorkBuddy
`POINTS` and generic `PLAN_TOKENS`. Unknown ZP models are unpriced; other
TIG deployments retain their rules. This is a reference estimate: TIG's
actual upstream routing and charge are not established by a suffix alone.

The default policy is revision `internal-2026-11-17-tig-2`; an existing
server's stored policy is deliberately not overwritten. Applying it requires
an explicit new policy revision through the server administration interface.
The new routing-catalog currency requires the updated desktop reader; deploy
server and compatible desktop together. No service deployment is implied by
this code change.


TIG's `-tc` and `-hs` suffixes denote separate Tencent and Volcengine
channels. Tencent's `TC_POINTS` factors are the internal reference table
provided for TIG, not public Tencent Cloud Token Plan rates; no weekly
balance is inferred. Fire's `VOLC_AFP` references the
[official enterprise AFP table](https://console.volcengine.com/ark/region:cn-beijing/docs/agent-plan-enterprise-afp-credits-billing-rules)
for models and modalities with confirmed rates, divided by 10,000 tokens.
Unknown channel/model combinations are not priced. These estimates do not
prove which exact commercial plan TIG forwards to or what it actually bills.
Protocol aliases such as `-openai-zp` and `-zp-openai` identify the same
channel and model; the original request ID is kept. Default model exposure
collapses aliases within a TIG channel, preserving explicit selections and
separate ZP, Tencent, and Volcengine channels.


TIG reference plan limits live in the server-managed `tig-plan-config.json`,
editable through the authenticated `/admin/tig-plan-config` endpoint and
published with the routing catalog. The current defaults are the requested
team advanced Zhipu reference (35,000/5h and 155,000/week), 200,000 AFP/month,
and 600,000,000 Tencent reference units/week. They are assumptions, not
proof of entitlements, pool ownership or renewal dates. Model suffix detection
accepts multiple channels; a failed list stays unknown. Weekly and monthly
periods require confirmed anchors. See `tig-plans.js` and its tests.

The signed `GET /reports/{user}/tig-plans.json` report sums observed v3
minute summaries per channel for rolling five-hour, seven-day and thirty-day
windows. These are user-level estimates rather than account, subscription or
billing-cycle totals: unpriced attempts are counted separately, period anchors
and account attribution are explicitly unavailable, and totals omit activity
outside Sub2Agent. The fixed local report proxy permits only JSON for this
report. No actual remaining balance is inferred.

For TIG requests with a recognized channel suffix, minute summaries also
retain `tig_request_model`, independently of the returned model. This keeps
different channels in separate groups even when a response omits the suffix.
The TIG report prices against the requested channel only when the returned
model has the same canonical identity; a different returned model remains
unpriced. Older summaries without the optional field retain their previous
interpretation. Deploy the accepting server before sending the new field.

The intranet routing catalog also publishes the active billing revision's
activation time and the peak schedule used by its charge function. The local
TIG quota estimate uses that snapshot and the current gateway ledger. It
counts only matching Zhipu requests under the selected key fingerprint, and
withholds full coverage if the available ledger or rate revision starts after
the window started. Unattributed requests, conflicting returned models and
unknown cache breakdown leave the window partially covered. A normal upstream
quota 429 establishes a recovery time. For the five-hour window, the first
locally observed successful call and the first success after each expiry
establish a new estimated start. An active 429 recovery takes precedence.
Without a window start, the gateway sums the selected key's priced requests
over the preceding five hours or seven days. It reports the rolling period
independently of the subscription window dates.

The TIG Usage tab detects channels from configured providers and retains a
Zhipu channel when a saved observation identifies it. For Zhipu, it offers an
enabled-key picker and shows the five-hour and weekly windows independently.
An active quota 429 shows the affected window as 100% exhausted until its
recovery time, even if the start or used points are unknown. Otherwise the card
divides locally priced points by the reference limit and labels the estimate's
rolling period and any gaps in coverage. With incomplete coverage and no
priced requests, the percentage stays unknown.
Quota bars are blue through 70% and red above 70%. Usage Details offers Token and the selected channel's
own billing unit, together with the applicable model rates. The panel
refreshes while the Overview is visible and cancels reads when it closes.

The provider editor shows the server-managed plan overview and model badges at
the model selection controls. The local `/api/accounting/tig-plans` endpoint
exposes the unexpired managed plan configuration and channel rates. The
overview combines detected channels across configured providers.
Before a TIG key is added, the security notice and three selectable channel
tabs explain the reference rules. After configuration, the security notice is
not repeated and only channels and model coefficients identified from that
provider's model list are shown. A missing model list never implies access to
all three channels.

## Public telemetry fallback

The intranet client probes 0.177 on the existing background delivery worker,
then uses the HTTPS collector at 124.220.199.224:8890 if the probe fails or
delivery hits a transport or temporary server error. The primary is retried
after about one minute. The application startup and gateway request paths do
not wait for the probes. The existing durable outbox retains unacknowledged
packets and continues retrying. Billing administration and report endpoints
remain on the existing intranet service, which is mirrored read-only on the
public billing replica at 134.175.165.190:5173 fed by a chunked token-
authenticated push over root's forward proxy
([134 deployment](../../services/usage-server/DEPLOYMENT-134.md)).

The public service uses the same v3 acknowledgement contract. Its SQLite inbox
acknowledges commits, serves only the supported telemetry routes to clients, and
exposes a separate token-protected incremental mirror. The BI sync on 0.177
mirrors the public inbox and publishes the internal aggregation rules to it.
The exporter merges those packets with the internal source by installation and
packet ID before aggregation, so a retried packet is not counted twice. Each
exported row carries a source tag, 内网 for the internal collector and 公网 for
packets taken from the public mirror; a packet seen on both channels keeps the
internal copy.
Existing installed clients need a build with the new fallback to use the endpoint.

The desktop Usage overview estimates WorkBuddy MaaS points for retained calls
that carry token counts but no vendor-reported credits. It uses the active
managed POINTS coefficient and the actual served model when supplied. Ordinary
input, output, cache reads and cache writes each enter the estimate once.
Unknown cache counts and missing rates do not create an estimate. Estimated
points are shown separately from vendor credits and currency-valued costs.
