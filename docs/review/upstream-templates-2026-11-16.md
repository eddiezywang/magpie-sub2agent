# Restore upstream routing recipes

All six recipes now use the upstream `origin/main` template algorithm, with no
private provider-specific branch, point-based sorting, TIG preference, zero-cost
override or intranet smart/steady renaming. The only remaining template-file
differences are the entry-list helper needed for regeneration and the existing
saved `templateKind` marker. Workspace accepts all six saved recipe kinds.

Plan, steady and fast require two distinct available providers; plan additionally
requires a plan-billed provider. Smart and thrifty require an eligible cheaper
model and may use one provider. Even uses the strongest model across its sources
and permits one source. Typed enterprise billing display remains independent.

A saved predefined recipe with unmet prerequisites has no runtime members/rules
and is unavailable. The original stored configuration is not overwritten and
returns when sources recover. Enabling it through the API is rejected while
prerequisites fail. Manual edits retain their existing regeneration opt-out.

Verified original template/recipe tests in both default and intranet builds;
intranet regressions cover same-source multi-model rejection, valid plan order,
source off/on recovery, enable rejection and manual-edit preservation. Focused
GUI/Workspace tests and provider/GUI vet passed. Four i18n guards passed.
Chromium and WebKit checked six original names, desktop/narrow layout, and an
unavailable plan card with the original two-provider reason and no create/edit
controls. Dual-engine billing-page acceptance still covers all ten retained
pages with synthetic APIs and no uncaught page errors.

The old combined routing/Agent review script uses retired Agent markup and
fails its unrelated Agent fixture; the current routing-only verification is
`build/review-upstream-templates.cjs`. No complete Go suite or live-account
inference was run. No desktop or accounting service was restarted or deployed.

[Milestone screenshots](http://124.220.199.224:8805/upstream-templates-20261116/index.html)
