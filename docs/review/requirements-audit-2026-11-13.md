# Internal distribution requirements audit

Settings was omitted from the previous implementation. The eight-control page
is now implemented in 1019c91; internal command isolation follows in d4c8efa.
This audit distinguishes implemented source from remaining work and deployment.

| Request | Current status |
| --- | --- |
| Flat settings with exactly eight named controls | Implemented; no upstream tab renderer, font discovery or settings search. 20 browser cases cover five locales and two widths. |
| Agent connection state once per page entry, old Codex endpoint, click to adapt, no added header | Implemented with local snapshot and explicit refresh. Desktop/session permissions remain independent of endpoint detection. |
| Product name sub2agent | User-facing identity implemented; original module/plugin/config compatibility identifiers and license attribution remain. CLI names now separate from original application. |
| Four routing templates without hard-coded model identities | Implemented using catalog ranking; only Balanced uses an intent classifier. Saved groups do not dynamically regenerate on price updates. |
| Server pricing, WorkBuddy point coefficients, promotion expiry and weekday peak billing | Not implemented/deployed in this repository; minute summary transport exists, billing server integration remains. No quota doubling rule was added. |
| Old TIG endpoint migration including /public/v1 and stable provider/model identity | Incomplete: importLegacyEndpoint still creates legacy-* IDs and its known endpoint recognition needs correction. |
| WorkBuddy hy4free discovery fallback | Incomplete: factory models() still reads the authentication bundle's model list without this fallback. |
| Internal model suffix normalization and capability lookup (-zp, -maas-username) | Incomplete: needs explicit aliases preserving upstream request IDs, capability and price matching. |
| Plugin marketplace internal deployment | Deployment assets exist; Internal rollout/access validation remains pending. Public review screenshots are not deployment evidence. |

The settings change does not erase unrelated saved preferences or disable every
programmatic API. Removed product controls no longer run their renderers. Existing
licensing text remains embedded through /api/notices; private credentials and
data are not included in review screenshots or downloadable binaries.

Release verification: 0.1.3913-sub2agent.17 was built from d4c8efa with a clean source tree. Nine pages passed against the packaged executable. The local portable application was replaced without changing its data folder; its running boot metadata reports .17 and PID 11592 owns ports 8989 and 8990. Original application PID 42876 remains running separately.
