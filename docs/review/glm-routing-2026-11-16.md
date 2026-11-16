# GLM routing preferences and separate WorkBuddy point systems

Internal builds offer two fixed-model presets in addition to the six unchanged
Magpie recipes: GLM 5.3 Flash first (recommended) and GLM 5.3 first. Each uses
Rotate with session affinity, includes at most one deployment per provider,
and requires two available sources of its exact canonical model. Managed
deployment aliases are shared with catalog identity; upstream IDs, accounts
and billing remain separate. No automatic model-tier substitution or Agent
configuration overwrite is introduced. Original recipes retain their definitions.

WorkBuddy configuration shows official point multipliers in neutral badges and
confirmed MaaS coefficients in accent outlines. A visible explanation describes
separate point pools and the weekly 300M MaaS allowance; the factors are never
multiplied. Expired/unknown rules are not interpreted as free. Coefficients and
pool confidence still come from the managed billing catalog, not model-name
guesses or inferred remaining balances.

## Verification

- New `TestInternalEvenModelPreferences` failed before implementation with empty
  preset members and ordered routing. After implementation, selection, missing
  source/model behavior, session affinity and preserved original IDs pass.
- `TestInternalEvenPreferencesPersistAndRecover` saves both presets through the
  real provider API, disables/re-enables a source, and checks pause/recovery.
- Focused intranet provider/template and GUI core-budget tests pass; original
  profile template tests and intranet provider/GUI vet pass.
- `build/review-upstream-templates.cjs` passes Chromium/WebKit across five
  languages, desktop and Chinese narrow layout. It exercises Edit first and
  inspects actual save payloads for rotate/session/exact members.
- `build/routing-billing-acceptance.cjs` passes both engines, checks differing
  computed badge styles, the visible explanation, expired rules and pool
  uncertainty, narrow layout, and opens all ten retained pages without uncaught
  JavaScript errors.
- All four i18n-key checks pass. Asset packing and core-script budget pass.
- Original group-template browser suite initially had one WebKit English click
  timeout (29/30 passed); the complete final rerun passed all 30 checks.
- Synthetic screenshot review:
  http://124.220.199.224:8805/glm-routing-20261116/index.html

No live account requests, remaining-balance/charge verification, full Go suite,
desktop binary release, plugin publication or billing-service deployment was
performed. Browser fixtures and Go package homes isolate real user data.
