# Unified reporting controls — .9 runtime verification

Implementation: `cbb15f9` on develop/intranet, pushed before building.

- One built-in Telemetry reporting / 埋点上报 switch controls collection and
  delivery. No aggregation switch, protocol version or destination inputs.
- Old opt-outs are migrated to the plugin switch; a subsequent explicit choice
  persists the clean row. Old address keys are absent from composed frontend
  config, and API writes to retired settings are refused.
- Both activity events and minute usage collect when reporting is enabled;
  minute aggregation is internal. Collector negotiation and retry remain internal.
- Plugin connection status no longer renders a server IP; registry metadata
  sent to the frontend omits the managed destination. Shipped README and build
  manifest omit service addresses. This is product-surface cleanup, not encryption
  or concealment of destinations from binary/network inspection.

## Checks

Windows accounting/reporting-plugin/pluginrt package tests, intranet packedasset
GUI/schema/privacy/translation/budget tests and scoped vet passed. Linux nogui
race checks passed for accounting, reporting plugin and pluginrt. Fourteen i18n
and Chromium/WebKit offline-market checks passed. Six production-asset reporting
previews cover Chinese/English and wide/narrow layouts without script errors.

The clean release was built from cbb15f9, workingTreeChanges:false:

```text
Version: 0.1.3913-sub2agent.9
Archive: magpie-builds/Sub2Agent-Magpie-windows-x64-20261113-115755.zip
Bytes: 72,941,406
SHA-256: cc4f73a29ccdfbd4999e2d10700e61597e17d056f16dcb33446915479cad5f7c
```

After confirming zero busy/waiting gateway lanes, the old instance was gracefully
quit via POST /api/window/quit?now=1. An initial GET had no effect; no binary was
replaced until the process actually exited. Code/README/manifest were backed up,
and the new executable started in the retained portable folder as PID 22560.
Data and credentials were retained; executable hash matches the release. The
original Magpie process (42876) remains separate.

`build/review-reporting.cjs` verified the live .9 app across Agents, Sessions,
Providers, Routing, Groups, Gateway, Usage, Plugins and Settings, with no script
errors or internal server IP in visible text. Live reporting has exactly one
switch, zero configuration fields, and no registry address metadata. Light/dark
reporting and plugin-market screenshots use the running app, not mocks. Session
content is masked in the retained local screenshot. No reporting switch was
changed during verification. Server ingestion/pricing integration remains pending;
neither this release nor the client tests prove collector acceptance.

Full repository tests were not run for this change. Release archives and generated
private provider bundles were not uploaded to the review website.
