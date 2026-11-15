# Production usage receipt verification — 2026-11-14

## Completed follow-up: model prices, CNY and original fonts

Deployed source `fdf87be` and re-read the real report. The same 306 calls now
have **zero unpriced attempts**, USD list-price equivalent 0.73189930475,
and **CNY 4.9148502112572 (display ¥4.91)**. No historical summaries were
rewritten. `legacy-*` provider identities no longer block model-name pricing.
The export reuses the existing desktop `provider.MakerPrice` implementation for
1,280 spellings from the bundled catalog. It was regenerated twice with the
same snapshot hash; deployment-suffix aliases preserve exact admin overrides.

API-equivalent valuation is separate from WorkBuddy points and plan-token
accounting. Reports default to CNY with a dated server-maintained CFETS reference
of 6.7152 CNY/USD (2026-11-13), printed on the image. It is a reference conversion,
not a live rate or an assertion of actual subscription charges. Truly unknown
models and minute totals whose request-size price tiers cannot be recovered
remain explicitly unpriced rather than assigned a guessed context tier.

The intended **JetBrains Mono + Noto Sans CJK SC Regular/Bold** font package is
now installed, with the Noto OFL license retained. The temporary Song font
fallback was removed. Receipt geometry and design were preserved. Fonts are
server assets and do not increase the desktop executable.

Verification: 10 Node integration/unit tests pass locally and on the production
Node 18 host; the legacy suffix regression fails against the previous pricing
module with `glm-5.3-flash-zp: false !== true`. The Go exporter ran under isolated
app configuration; gofmt, targeted Go vet and deterministic snapshot checks
passed. The full desktop Go suite was not run for this server-only change.

The encrypted release followed the authorized laptop/idisk/KF/jump route and
its SHA-256 matched on the destination. Production source and font configuration
were backed up; listeners were stopped and released before updating. Both live
report endpoints generated PNGs with the expected real counts and positive CNY
valuation. Both images were visually checked, and the updated preview and PNGs
returned HTTP 200. The public encrypted transport artifact was removed.

- [Updated preview](http://124.220.199.224:8805/usage-eddiewang-20261113.html)
- [CNY daily PNG](http://124.220.199.224:8805/eddiewang-daily-20261113-cny.png)
- [CNY weekly PNG](http://124.220.199.224:8805/eddiewang-weekly-20261113-cny.png)

## Initial verification, before the follow-up above

Verified the existing internal service with real `eddiewang` reports, not fixture
traffic. The daily report for 2026-11-13 contains 306 calls, 439,150 input tokens,
179,378 output tokens and 14,300,480 cache-read tokens: 14,919,008 total tokens.
The report's cache-hit rate rounds to 97%. No calls for this username were present
in the 2026-11-14 daily report at verification time.

Collection and username aggregation work for these records. Pricing is **not
complete**: their provider is a migrated `legacy-*` identity and their context
classification is `unclassified` with no rules revision. All 306 attempts remain
unpriced. Historical raw summaries were not rewritten or assigned an invented
price. The local build machine separately has a delivery backlog and is not
evidence that every client can reach the collector.

Receipt rendering now includes the username, distinguishes pending pricing from
free USD, and preserves POINTS and PLAN_TOKENS as separate units. Seven local
usage-server tests pass, including receipt currencies and the HTTP cache-rate
regression. The latter fixes an omitted zero `cacheUnknown` counter in report
views that previously produced `NaN%`.

The server's configured Noto font path did not exist. Its installed JinbiaoSong
font was selected through `usage-server.service.d/receipt-font.conf`, with an
explicit matching fallback in the SVG. Both rendered PNGs were visually checked:
Chinese text, username, pending-pricing notice and numeric cache rate are legible.

The initial full deployment hit a transient address-in-use error and rolled
back. After checking listener ownership and restoring health, the receipt-only
changes were deployed with backups, an explicit service stop, a check that both
ports were released, and a fresh start. Both managed listeners passed health
checks and report PNG generation succeeded. Production data and credentials were
retained. Source commits: `af6109b`, `a6ff9ff`.

The release archive followed the server → laptop → personal idisk → KF → jump
session → internal server route; SHA-256 was verified before extraction. The
temporary public transport artifact was encrypted and removed after transfer.
Only the requested report images and a static review page were published:

- [Daily and weekly preview](http://124.220.199.224:8805/usage-eddiewang-20261113.html)
- [Daily PNG](http://124.220.199.224:8805/eddiewang-daily-20261113.png)
- [Weekly PNG](http://124.220.199.224:8805/eddiewang-weekly-20261113.png)

All three public resources returned HTTP 200 with the expected content types.
These images are usage statements, not settlement invoices.
