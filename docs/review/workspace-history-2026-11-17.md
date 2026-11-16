# Workspace request history

Implementation branch: `feature/workspace-request-history`, based on
`67236e81e` (the current guided workspace). The upper Agent/provider/policy
workflow is preserved. No application release or plugin-market publication
is part of this change.

## Behavior

- The desktop workspace scrolls Agent controls, the live routing stage,
  throughput and request history together in its left column. Providers stay
  in the right column, with their own overflow if needed.
- Narrow windows use one scrolling workspace with the existing provider-first
  order. Request history has no nested vertical scrollbar in either layout.
- The original request instance, filters, details and trace polling are reused.
  Long persisted histories use the active workspace viewport for virtualization.
  Redraws retain a visible historical row when new live requests arrive.
- Account activity remains available in a collapsed disclosure below requests.
- Routing groups are presented as Routing policies. Internal identifiers and
  routing configuration are unchanged. The standalone Routing navigation is
  removed; old URLs and tray/internal request openers resolve to the workspace.
- A queued animation safely ignores a request already evicted from the trace.

## Verification

Packed intranet assets were generated with:

```
go run -tags intranet ./build/assetpack internal/gui/assets <output.zip>
```

Both Chromium (installed Chrome) and WebKit passed:

- `build/workspace-history-acceptance.cjs`: old routing URL redirects, request
  50 is selected, policy label, fixed inspector, a single history scroller,
  visible row preserved after a new request, 700 persisted records rendered
  with fewer than 250 request nodes and the oldest record reachable, account
  disclosure, session/request grouping, date switches, request details, one
  trace request in flight and narrow viewport overflow.
- `build/workspace-guided-acceptance.cjs`: original upper guided workflow,
  native provider controls, pending/failure/retry, target isolation and themes.
- `build/workspace-lifecycle-acceptance.cjs`: six leave/reenter cycles, one
  original host per surface and observer release on leave.
- `build/workspace-pages-acceptance.cjs`: all ten navigation targets (including
  the old Routing alias), light/dark at 1440/1024/390, no uncaught script errors
  or horizontal overflow and keyboard disclosure controls.
- `build/workspace-focus-acceptance.cjs`: refresh retains keyboard focus and
  respects later focus changes or navigation. Its expected wording now uses
  routing policies.
- `build/workspace-providers-acceptance.cjs`: add/detect, enable/disable,
  refused-save retry, provider-page synchronization and synthetic sign-in.

The original `internal/gui/tests/routing-day-window.test.cjs` passed all 30
cases across five languages, desktop/narrow and both engines, including 2,000
records and stable sizing. The first Chromium attempt could not launch because
its expected bundled Chromium 1254 was absent; the 15 Chromium cases were
rerun successfully with a local launch adapter selecting installed Chrome.
The original 15 WebKit cases passed without that adapter.

Focused Go checks passed with `nogui intranet` for asset packing, internal
index contracts, workspace strategy and core script budget. The upstream
`nogui` core script budget passed too; no budget was raised. JavaScript syntax
and `git diff --check` passed.

Negative control: restoring the old CSS that hides `.rt-more` makes the new
history acceptance fail because request rows are hidden. The packed CSS was
restored after the check.

Synthetic screenshot gallery:
http://124.220.199.224:8805/workspace-history-20261117/index.html

This verification uses isolated synthetic APIs and no real account credentials
or Agent configuration writes. Full Go suite, native desktop binary packaging
and release-feed deployment were not run.
