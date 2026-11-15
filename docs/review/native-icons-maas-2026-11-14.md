# Native pixel branding and MaaS budgets — .21

Review: http://124.220.199.224:8805/pixel-brand-icons.html

The local app was gracefully stopped and restarted with .21 using its existing
data directory. The boot version and WorkBuddy 1.0.5 baseline are active.

Native EXE resources, runtime window/app icon, Windows tray ICO and GUI header
now share the original blue pixel S in `build/pixel-icons/custom.py`. Verified
all nine native sizes and tray bounds; extracting the associated icon from the
built EXE returns that S. Upstream builds retain their separate native artwork.
Playwright checked all nine retained pages: no page errors or failed brand
responses. Native small-size/theme comparisons and current app screenshots are
published on the review page.

Authenticated model-list inspection confirms all ten account MaaS deployments
(including Auto MaaS) expose an effective 100,000 input window and 32,000 output.
The plugin declares 132,000 total with 100,000 input; smaller upstream limits
remain. Non-MaaS model declarations are unchanged. This operational Agent budget
is not a measured model capacity and cannot guarantee every payload fits the
separate 900 KiB request-byte guard. No long-context inference was performed.

The live cheap template now starts with hy4free, followed by all MaaS models,
then the remaining WorkBuddy models. The client could not obtain a managed
routing catalog, so previously hy4free's unknown price put it after known-price
models. The new offline preference does not declare it permanently free; a
positive server score removes the free-first tier. Server pricing remains
independent of this fallback. Manually edited groups keep their explicit order.

Verification: 15 provider adapter tests; internal provider template regressions;
GUI native brand, tray size, core-budget and assetpack tests; real app model-list
and cheap-template assertions. Screenshot verification also confirms the 100K
window in the model settings UI.

Build .21: 79,205,888-byte single EXE, no embedded Bun; ZIP 32,042,181 bytes.
Published as `downloads/Sub2Agent-windows-x64-latest.zip` on the review server;
remote SHA-256 matches
`9fa15baef00239759e1d228a05c4e3d636ee5603cec9e3afc61acd745ebf3235`.
The internal marketplace deployment itself has not been changed in this step;
the embedded 1.0.5 baseline supersedes older installed marketplace packages.
