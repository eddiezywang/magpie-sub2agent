# Native workspace preview refinement — 2026-11-15

Entry: `design-preview/routing-workspace.html` (serve repository root over HTTP).

The preview composes native Agent, Providers, Routing and Groups renderers in
isolated frames. It shares intranet-retro.css, original controls and pixel icons.
Agent access starts collapsed; the right provider rail adapts the original page.
Routing keeps its native container and adds predefined group selection and
expandable output throughput with provider/model/session series.

Data is synthetic. No request reaches live APIs or original application data.
Group selection demonstrates selection state; it does not apply routing rules.
Native editor saves, sign-in and other unsupported mutations return an explicit
preview-only error. Production integration and backend telemetry are pending.
Throughput refreshes each second using a trailing five-second average; charts
retain 180 samples. Each series tracks its own peak rather than summing peaks.

Verification: `node build/review-workspace-preview.cjs` with Playwright installed.
Chrome and WebKit passed at 1440, 1024 and 390px: native colors and border,
collapsed Agent summary, connect toggle/counts, model menu, provider editor and
Add panel, preset selection, changing rates, peak bounds, dimension sparklines,
group navigation, no horizontal overflow, no page exceptions or escaped requests.
JavaScript syntax and git diff whitespace checks passed.

Milestone screenshots are under `design-preview/workspace-review/`; all contain
only fixtures. They are ready for the review site; this step has not uploaded
them to the remote review server.

Follow-up: restored TIG/CIB original pixel icons and hyphenated preset names;
expanded sparklines to 220px on wide surfaces and the rolling window to 180s.
Playwright checks also assert loaded logos and exactly 180 points per series.
