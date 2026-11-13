# Usage server source baseline

Source imported from the existing authorized internal deployment on 2026-11-13.
Only application code and its package manifest were copied. No environment,
credentials, production data, fonts or node_modules are included.
The existing deployment retains its assets and persistent data independently.

Run with Node 18+ (`node src/server.js`). Before deploying changes, back up the
existing code, retain its service environment and data directory, run isolated
integration tests and check the existing health/report paths after restart.

## Minute summaries and billing

`GET /healthz` advertises `sub2agent-usage/3`. `POST /usage/events` accepts
`{schema,username,install_id,summaries:[...]}` with accepted/duplicate/rejected IDs.
Acknowledgement follows fsync. A conflicting same-ID payload is rejected.
Legacy `/events` and old event ingestion remain compatible. New production
clients send only minute summaries; there is no client reporting-mode switch.

`GET /usage/aggregation-rules` contains classification boundaries, never prices.
`GET/PUT /admin/billing-policy` uses the existing admin Bearer token. Every edit
requires a new immutable revision; old revisions remain available for validating
context tiers in historical summaries. Same-boundary price edits can reprice
history; changed boundaries cannot recover individual request sizes.

Report `billing.amounts_by_currency` separates WorkBuddy POINTS, plan-accounted
PLAN_TOKENS and actual USD. WorkBuddy coefficients are enterprise-provided policy,
not dollar rates. GLM plan token accounting is halved on China weekdays 14:00–18:00,
without changing gateway quota or 429 handling. Promotions support `valid_until`;
no end date for hy4free was provided, so its server-side zero coefficient is an
administrator-maintained current promotion, not a client permanent-free flag.
Unknown/unclassified models remain explicitly unpriced. Pricing is by completion
minute. Per-request details/quantiles cannot be reconstructed from these sums.

Run `node --test test/summary.test.js` with an isolated temporary directory.

`GET /usage/routing-catalog` publishes only relative routing scores with a
24-hour document lifetime and optional promotion expiry. Scores default to
policy coefficients and may use `routing_score` to express a different relative
selection weight. This is separate from billed currency and time-of-day billing.
The client refreshes this cache without exposing the infrastructure address.
