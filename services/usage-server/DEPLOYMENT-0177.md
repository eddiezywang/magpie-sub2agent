# 0.177 deployment and source inventory

This document describes the deployment observed on 2026-11-15. The committed
source is the desired next version, not proof that a particular commit is live.
Access is through KF and the configured `wecli test-jump` session; verify the
remote hostname and target before making changes. Never commit or print keys,
admin tokens, user reports, runtime databases, or production configuration.

## Usage and billing service

- Source: `services/usage-server/src`, `package.json`, and `assets` in this repo.
- Host: `172.21.0.177`, `/opt/usage-server`; systemd unit `usage-server.service`
  runs `/usr/bin/node src/server.js` with working directory `/opt/usage-server`.
- Data: `/var/lib/usage-server`; do not copy it into a release or replace it.
- HTTP listeners: 17891, and 17890 via the `sub2agent-alias.conf` drop-in.
- The `billing-signature.conf` drop-in references a root-only HMAC key at
  `/etc/sub2agent/billing-signing.key`. `receipt-font.conf` sets the font
  configuration. Preserve both drop-ins, their paths and permissions.
- PNG rendering requires `@resvg/resvg-js` and the installed JetBrains Mono and
  Noto Sans CJK SC Regular/Bold font assets. Do not replace `assets/fonts` or
  `node_modules` with a release archive. The source manifest requires Node 18+;
  the observed unit uses `/usr/bin/node` (Node 16.20.2). Validate the runtime and
  native dependency on an isolated copy before choosing an update; do not
  upgrade shared `/usr/bin/node` without checking other services.

On 2026-11-15, source hashes matched the repository apart from `card.js` and
`icons.js`: the host still had the pre-pixel receipt versions, while the repo
contains the approved lake/blue-logo/pixel-icon update. The server and signature
verifier were already deployed. No update was deployed during this inventory.

### Safe release procedure

1. Run `node --test services/usage-server/test/*.test.js` on a compatible Node
   installation, and render synthetic short and long PNG reports. Compare the
   existing host's source and asset hashes and systemd drop-ins against the
   expected baseline. Investigate any unexpected changes; do not overwrite them.
2. Package only the reviewed `src`, `package.json`, `assets/lake.jpg`,
   `assets/sub2agent-logo.png`, and `assets/icons`. Transfer via the established
   authorized KF route and verify SHA-256 at each hop. Install dependencies in an
   isolated staging directory using a compatible runtime; retain existing fonts,
   data, keys and configuration. Do not include them in the package.
3. Back up the current source, package manifest and affected assets outside the
   live directories. Test an isolated staged service with a temporary data
   directory and a nonproduction fixture key and ports; verify health, PNG,
   signed/unsigned report and replay handling. Record the backup and source
   commit. Check the expected active service and listeners before cutover.
4. During the maintenance window, deploy the reviewed code and assets, preserving
   `assets/fonts`, `node_modules`, data, keys, ownership, unit and drop-ins.
   Restart `usage-server.service`, check both health endpoints and the unsigned
   401 and signed synthetic report on both listeners. Check telemetry ingestion
   and service logs without printing credentials or personal reports. If health
   or verification fails, restore the saved application files and restart.

`deploy-update.py` is a historical source-only helper. It does not install or
back up the new receipt assets, and does not test signed reports; **do not use it
alone for the current release**.

## Plugin marketplace and app updates

- Source: `deploy/plugin-market/serve.py` and the publication scripts under
  `deploy/plugin-market`, plus the app release builder in
  `build/intranet-release`. The observed `serve.py` hash matches the repo.
- systemd `sub2agent-plugin-market.service` runs
  `/opt/python311/bin/python3.11 /opt/sub2agent-plugin-market/bin/serve.py
  --root /opt/sub2agent-plugin-market/www --port 18989`.
- App releases are static signed artifacts below
  `/opt/sub2agent-plugin-market/www/sub2agent/releases/`; plugin registry and
  package artifacts share the managed web root. Preserve published versions.
- Follow `build/intranet-release/README.zh-CN.md`: build and sign on the
  administrator workstation, verify hashes during transfer, copy a new version
  directory, then atomically replace `latest.json` after verifying the files.
  The signing private key stays off the host and out of Git. The domain mirror
  is an independently published copy, not a reverse proxy to this host.
