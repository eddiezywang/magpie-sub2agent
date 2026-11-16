# WorkBuddy point-aware routing

The application retains Magpie's native provider editor and routing-group
interactions. No component library or additional routing strategy was added.

## Behavior

- Routing catalog rules retain currency, reference coefficient, source and
  revision. Active, expired and unknown are distinct. Exact rules override
  broad defaults; an expired exact rule cannot fall through to a free default.
- Enterprise point coefficients no longer overwrite the USD output-price field
  used for capability ranking. Cost preference orders confirmed free, plan
  allowance, points, pay-as-you-go and unknown. Different units are never
  compared numerically. Within enterprise units, comparison is scoped to a
  provider or explicitly established shared pool.
- WorkBuddy `modelCredits` is retained as a vendor display multiplier. It is not
  converted into a per-token coefficient, a dollar cost or free eligibility.
  WorkBuddy enterprise baseline advances to 1.0.10; published CIB 1.0.9 and
  unrelated providers remain unchanged.
- Native model chips, group members and template descriptions expose the
  billing information and configured preference. Unknown pool scope remains
  visible. Existing manual group edits retain their opt-out from regeneration.
- Enterprise/CIB credit refusals pause the refusing model, rather than guessing
  that every model on that account is spent. Other candidates are tried on
  their own upstream response. No shared balance is manufactured.

## Verification

- Focused intranet catalog, provider, GUI and gateway Go regressions passed.
  These cover rule refresh/expiry, coefficient-driven order, independent
  capability order, cross-currency source preference, template discovery/manual
  opt-out, saved-template regeneration after billing cache reload and
  enterprise/CIB refusal scope. Targeted `go vet -tags intranet` passed for the
  four affected packages.
- 37 generated enterprise/CIB/adapter/login tests passed after merging current
  main, using the matching private source `def6059`.
- 12 usage-server routing/billing/summary tests and four i18n key checks passed.
- Playwright Chromium and WebKit verified native billing chips, rule expiry,
  revision/pool explanations, narrow layout and reload. All ten retained pages
  opened without uncaught JavaScript errors, including Sessions.
- Screenshots use synthetic models and accounts only. No desktop/demo server
  was started by these browser checks.

## Review images

[Provider and group screenshots](http://124.220.199.224:8805/workbuddy-points-20261116/index.html)

## Limits and deployment

No real-account inference, real deduction comparison or complete Go suite was
run for this change. Upstream shared-pool definitions and CIB screenshot-rate
metering bases remain unconfirmed. Reference coefficients are not settlement
amounts. New typed metadata requires the updated usage server as well as the
updated desktop. Existing installed clients, marketplace packages and live
accounting services have not been upgraded by this change.
