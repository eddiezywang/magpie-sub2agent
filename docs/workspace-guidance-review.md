# Workspace guidance review — 2026-11-17

The workspace guides provider setup, Agent connection and policy selection in
that order. Native provider and Agent controls remain available in place; detailed
group editing opens Groups. Existing model preferences survive reconnects.
Flash first is the first-connection default only when no model was selected and
recognized candidates exist. Both new tier presets accept a single source and
retain session affinity. The original six Magpie recipes are unchanged.

Milestone screenshots, using synthetic accounts only:
http://124.220.199.224:8805/workspace-guidance-20261117/index.html

Verified:

- Focused intranet provider and GUI tests: tier selection, cross-source aliases,
  shared-model preference, single-source eligibility, idempotent group creation,
  first connection, stale-model rejection, reconnect and explicit-model retention.
- Packed frontend `build/workspace-guided-acceptance.cjs`, Chromium and WebKit:
  ordered guidance, disabled-provider and disconnected states, selected-Agent
  isolation, pending save, failure preservation, retry, native provider sheet,
  retained pages, light/dark and desktop/narrow layouts without overflow.
- `build/workspace-acceptance.cjs`, both engines: native/bulk connection write
  gates, partial failure/retry, unknown state, provider draft navigation guards,
  unique native hosts, five locales and throughput polling lifecycle.
- `build/workspace-focus-acceptance.cjs`, both engines: focus during pending,
  failed and superseded group reads, native menu and navigation behavior.
- `build/review-upstream-templates.cjs`: eight recipes and session-affinity
  editor payloads in both engines, five locales and narrow Chinese layout.
- `internal/gui/tests/i18n-keys.test.cjs`: all four checks pass.

The earlier separate workspace template-button assertions have been replaced
by the guided menu acceptance suite; native-workflow assertions remain.
Full repository tests, live vendor requests, packaged application installation
and KF rollout were not performed in this step. The model tier registry is
explicit: unrecognized models remain selectable manually, without guessed tiers.
