# Internal distribution requirements audit

Settings was omitted from the previous implementation. The eight-control page
is now implemented in 1019c91; internal command isolation follows in d4c8efa.
This audit distinguishes implemented source from remaining work and deployment.

| Request | Current status |
| --- | --- |
| Flat settings with exactly eight named controls | Implemented; no upstream tab renderer, font discovery or settings search. 20 browser cases cover five locales and two widths. |
| Agent connection state once per page entry, old Codex endpoint, click to adapt, no added header | Implemented with local snapshot and explicit refresh. Desktop/session permissions remain independent of endpoint detection. |
| Product name sub2agent | User-facing identity implemented; original module/plugin/config compatibility identifiers and license attribution remain. CLI names now separate from original application. |
| Four routing templates without hard-coded model identities | Server-owned relative scores drive templates. Plan chooses small Coding Plan models then alternate sources. New template groups refresh with discovery/policy; explicit edits and older saved groups stay manual. Only Balanced classifies tasks. |
| Server pricing, WorkBuddy point coefficients, promotion expiry and weekday peak billing | Implemented and deployed on the existing internal server. v3 durable minute summaries, cross-device username aggregation, separate POINTS/PLAN_TOKENS/USD, current hy4free promotion, weekday GLM accounting factor. No quota doubling or invented USD rates. |
| Old TIG endpoint migration including /public/v1 and stable provider/model identity | Implemented including previously imported legacy IDs. Canonical provider sub2agent-tigcodingplan, old model references retained as aliases, routing/settings references migrated, keys preserved. |
| WorkBuddy hy4free discovery fallback | Provider 1.0.3 adds/deduplicates hy4free and passes it to request resolution. Recorded adapter inference test passes; actual tenant entitlement not independently verified. |
| Internal model suffix normalization and capability lookup (-zp, -maas-username) | Implemented conservative aliases preserving actual request IDs, explicit deployment metadata and capabilities. Image input is inherited; image generation is not invented. |
| Plugin marketplace internal deployment | Installed, active and verified from a separate intranet host: three retained packages, metadata, downloads and SHA checks. WorkBuddy/TIG 1.0.3, Notify 0.1.4. Disabled adapters are not published. |

The settings change does not erase unrelated saved preferences or disable every
programmatic API. Removed product controls no longer run their renderers. Existing
licensing text remains embedded through /api/notices; private credentials and
data are not included in review screenshots or downloadable binaries.

Release verification: 0.1.3913-sub2agent.18 was built from 1f34dcc with a clean source tree. Nine pages passed against the packaged executable. The local portable application was replaced without changing its data folder; running boot metadata reports .18, provider 1.0.3, and PID 21156 owns ports 8989 and 8990. Original application PID 42876 remains running separately. Tests and remaining validation limits: [validation issues](test-limitations-2026-11-13.md).
