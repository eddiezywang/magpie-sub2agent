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


## Impeccable interaction review, 2026-11-17

Two isolated assessments reviewed the packed interface with synthetic APIs.
The independent design assessment scored 29/40 before fixes. System status,
real-world match, user control, recognition, efficiency, minimalism and help
scored 3 each; consistency scored 4; prevention and recovery scored 2 each.
The technical assessment scored 15/20 (accessibility 2, performance 3, theming
4, responsive 3, integrity 3). The static detector returned no findings.
The incumbent beige dotted surface, pixel icons, original provider controls
and original routing diagram remain the visual authority.

Confirmed findings and fixes: background Agent redraws retain guide and next
button focus; disabled/unready saved templates are unavailable in the picker
and default CTA; failed policy recovery says Refresh status; unknown connection
checks offer explicit rechecking; narrow DOM reading order starts with providers
and desktop CSS keeps providers on the right. The native menu's optional
expanded-state enhancement remains outside this change.

Regression acceptance fails on the old client with `reading order starts with
providers`, and passes with the fixed client in Chromium and WebKit. Native
workspace and focus suites also pass both engines; four i18n checks pass.
Physical touch, packaged WebView2, live detector overlay (browser PNA blocked
loopback), full contrast scanning and the full cross-platform Go suite were
not verified in this frontend refinement.

Interactive synthetic preview:
http://124.220.199.224:8805/workspace-live-20261117/?view=workspace
Export it with `build/export-workspace-preview.cjs`; no real vendor credentials
or live account requests are used. Policy changes and Agent controls operate on
in-memory sample data; vendor sign-in and unsupported edits explicitly refuse.
Published-page Playwright verification covers policy writes, Agent expansion,
no console errors and 390px overflow; milestone screenshots are captured.

Questions skipped: the user already authorized refinement and public publication.
