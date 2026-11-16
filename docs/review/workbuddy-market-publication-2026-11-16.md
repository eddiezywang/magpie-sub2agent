# WorkBuddy plugin marketplace publication

Published on 2026-11-16 from distribution main `5f9f0a15e` and private
Sub2Agent `def6059`. No application executable, account data, service code or
client configuration was changed.

| Package | Version | ZIP bytes | SHA-256 |
| --- | --- | ---: | --- |
| `@sub2agent/workbuddy` | 1.0.9 | 59554 | `9a257437ed8847a6b9f143168a03dab0487651374a646f69cc7b07f1a1845821` |
| `@sub2agent/workbuddy-cib` | 1.0.9 | 40113 | `102655dbb14ebb295907427d7b41db5bbb27520eb61cea6cc1528e7aa54e2bf2` |

## Internal market

Endpoint: `http://172.21.0.177:18989/magpie/plugins/registry.json`.
Root: `/opt/sub2agent-plugin-market/www` on `vm-0-177-centos`.
The existing enterprise plugin was 1.0.4 and CIB was absent. Enterprise was
updated and CIB added, raising the catalog from 18 to 19 entries. The other
17 entries were preserved exactly and older immutable artifacts remain.
The existing systemd service stayed active without a restart.

Rollback metadata backup:
`/opt/sub2agent-plugin-market/backups/before-workbuddy-1.0.9-20261116-194130`.
It contains the previous registry, prior package latest metadata, and a record
of which metadata paths previously existed. Restore the registry and latest
metadata together using same-directory atomic writes; retain immutable ZIPs.

Transfer used authenticated `hc` file writing to KF and KF's existing
`wecli test-jump` access to 0.177. The laptop's iDisk CDP connection was
unavailable; its client was not restarted. A first ZMODEM attempt failed because
the destination directory did not exist; after inspecting the session and
creating the dedicated directory, the transfer succeeded. The 103235-byte
publication archive's SHA-256 matched locally, on KF and on the final server:
`5f8ce743398a56a0e17e0d19220861e3d798b5c2b354e4656015391cd1a88330`.

## 224 mirror

Endpoint: `http://124.220.199.224:8899/magpie/plugins/registry.json`.
The existing server on 8899 previously served only application releases.
The two plugin entries and npm-compatible metadata were added to the same
static root `/var/www/sub2agent-update-8899`, with each download URL pointing
to that mirror. No listener, service, application-release file or public
review-site directory was changed. This mirror currently lists these two
plugins; it is not a copy of the full 19-entry internal catalog.

Rollback metadata backup:
`/opt/sub2agent-release-mirror/backups/before-workbuddy-1.0.9-20261116-193931`.

The current intranet application's plugin source remains 0.177. Publishing the
224 mirror does not change client source configuration or its download allowlist.

## Verification

- The existing marketplace publisher's two unit tests passed.
- The publication runner passed isolated checks for preserving unrelated
  entries, repeat publication and refusing changed content at an existing version.
- Both servers verified catalog entries, package latest metadata, ZIP length,
  manifest package/version and SHA-256 during publication. Metadata is backed
  up before cutover and restored if post-publication checks fail.
- KF independently fetched health, catalog, all 19 plugin ZIPs and latest
  metadata from 0.177; all lengths, hashes and versions matched.
- The administrator workstation independently downloaded both 224 ZIPs over
  HTTP and verified their hashes, lengths, manifests and latest metadata.
- The same immutable ZIP bytes are served from both endpoints.

This verifies distribution. Real-account Claude/Codex inference and the broader
suite limitations remain as recorded in
[implementation verification](workbuddy-prompt-compat-2026-11-16.md).
