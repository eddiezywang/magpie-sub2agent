# Username-owned minute usage summaries

Code is committed and pushed on develop/intranet:

- `8817b8b`: bounded numeric minute aggregation and v3 collector contract.
- `75a3a68`: live observer/queue/transport integration and translated controls.

The username and installation ID are included once in each transport envelope.
Every persisted summary retains the username at collection time; restarting
under a different login does not reassign pending usage. Collectors should map
verified installations to users and deduplicate by installation + packet ID,
then add deltas across devices for user reports.

New gateway records no longer produce per-request outbox files. They increment
minute counters in memory, grouped by agent, provider, actual model/provenance,
observed service tier, rules revision and context tier. At UTC minute boundaries,
the client freezes immutable deltas and persists bounded summary packets. Graceful
stop seals a partial minute; an abrupt exit can lose the current minute, as agreed.
Frozen packets survive restart and collector outages. Failed disk writes retain
the packet ID in bounded memory; exhausted memory is observable as dropped_calls.
Local usage.jsonl and Sessions storage are not removed by this change.

Only server-provided classification boundaries are cached locally. Prices and
report generation remain server responsibilities. Unknown classifications and
incomplete token/cache observations are explicit, not zero-price defaults.
An exact v3 capability and named summary acknowledgements are required. Pending
historical v2 records retain their compatibility path, and legacy /events keeps
its old envelope. New reporting remains opt-in until collector support exists.

## Verification

- Windows: complete accounting and pluginrt package tests; usage observer and
  application-quit tests; packed intranet GUI/translation/core-budget guards.
- Linux: nogui accounting and pluginrt race tests passed.
- Scoped Windows/Linux vet passed; Windows intranet packedasset executable built
  for verification at `.build-tools/sub2agent-minute-qa.exe` (not a packaged release).
- Counter tests cover cache splits, reasoning overlap, strict tier boundaries,
  missing rules, rule changes, zero-token observations, retries and handoffs.
- Runtime fixture: 1,000 calls in one group create zero request outbox files,
  then exactly one minute-summary file. Replay retains the original username
  even after changing the environment from alice to bob.
- Queue failure, frozen-ID retry, corrupted rules preservation, collector version
  negotiation and forged acknowledgements are tested against loopback fixtures.
- Deliberately adding reasoning to output again makes the intended aggregate
  total test fail; restored code passes.
- Aggregation benchmark on the local Windows CPU: about 243 ns/call for one rule
  and 13.3 us/call scanning 4,096 rules, both zero allocations in that benchmark.
- Eight i18n checks passed. Playwright Chromium and WebKit each checked Chinese
  wide/light, English wide/dark and Chinese narrow/dark settings using packed
  production assets. No script errors or horizontal page overflow.

The review screenshots are isolated settings previews backed by the actual
Options schema and production assets, not evidence that a new binary was started.
The previously running .8 app is unchanged. No reporting settings or credentials
were altered. Full repository tests were not rerun for this step.

## Remaining live integration

The kf route remains unavailable: hc cannot reach its SSH relay. Therefore the
existing `/opt/usage-server` on 172.21.0.177 has not been updated or tested with
v3. Its rules, persistence/acknowledgement and pricing/report adapters still
need implementation and live validation. No client-only test is presented as
successful ingestion by that service.
