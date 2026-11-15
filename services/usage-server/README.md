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
Flat-rate models are priced without context-classification metadata; unknown
models and request-size tiered minute summaries remain explicitly unpriced when
their individual request sizes cannot be recovered. Pricing is by completion
minute. Per-request details/quantiles cannot be reconstructed from these sums.

Run `node --test test/summary.test.js` with an isolated temporary directory.

`GET /usage/routing-catalog` publishes only relative routing scores with a
24-hour document lifetime and optional promotion expiry. Scores default to
policy coefficients and may use `routing_score` to express a different relative
selection weight. This is separate from billed currency and time-of-day billing.
The client refreshes this cache without exposing the infrastructure address.

## Model list prices and CNY receipts

Refresh `src/catalog-prices.json` from the exact bundled catalog and the desktop's
existing `provider.MakerPrice` implementation (no network or live config):

```
go run -tags intranet,nogui ./services/usage-server/tools/export-catalog
```

Run this from the repository root. The snapshot records the source catalog hash.
Prices are USD per million tokens. Server administrator overrides take precedence;
old automatically seeded entries are refreshed from the catalog. Exact deployment
prices win before `-zp`, `-zp-openai` and `-maas[-account]` alias resolution.
Minute summaries from `legacy-*` providers use the same model prices. Reasoning
tokens are already part of output; cached reads and cache-write TTLs retain their
separate prices. Never select a request-size price tier from a minute's token sum.

Report `valuation` is the API list-price equivalent in CNY; original USD fields
and enterprise point/plan accounting are retained separately. The dated exchange
rate is maintained in `report-currency.json`, exposed only through authenticated
`GET/PUT /admin/report-currency`. The initial 2026-11-13 CFETS reference is
6.7152 CNY/USD, not a live quote or actual charge. The receipt prints its date/rate.

Keep the original JetBrains Mono fonts and install the OFL-licensed Noto Sans CJK
SC Regular/Bold fonts under `assets/fonts` with their license. They are available
from [the Noto CJK project](https://github.com/notofonts/noto-cjk/tree/main/Sans).
`USAGE_SERVER_FONT_FILE` may name an additional font; a missing CJK font must be
fixed by installing the intended font rather than redesigning the receipt.

`USAGE_SERVER_ICON_DIR` selects the deployed brand asset directory. For the
internal pixel theme, copy `build/intranet/pixel-icons` there (including its
manifest) and retain the MIT notice from `build/pixel-icons/vendor/LICENSE`.
Pixel SVGs keep their original palette and crisp edges in receipts; traditional
SVGs retain the existing monochrome/two-tone rendering. PNG fallbacks remain
available, while generated SVG counterparts are preferred by the renderer.

## Signed report access

The service reads a 64-character lowercase hex HMAC key from the root-owned file named by `USAGE_SERVER_BILLING_KEY_FILE`. Missing or invalid keys fail closed for `/users` and `/reports/...`; the ingestion and legacy telemetry endpoints are unchanged. The application must be built with the corresponding key file using `build/intranet.ps1 -BillingKeyFile <path>`. See the accounting subsystem reference for the signature format, replay behavior and shared-key limitations. Do not put the key in the repository, logs, URLs or screenshots.
