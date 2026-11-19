# 134.175.165.190 deployment (public billing replica)

Deployed on 2026-11-19. This host serves the usage/billing reports that used
to be reachable only on the 0.177 intranet service, at
`http://134.175.165.190:5173/`. 0.177 remains the primary collector and
administrative host; 134 is a data replica: reports are read-only, ingestion
through the public port is token-protected, and all data flows one way from
0.177. Scripts: [deploy/134-replica/](deploy/134-replica/).

## Layout

- `/opt/usage-server` — application (`src/`, `package.json`, `assets/` with
  fonts and pixel icons under `assets/icons-pixel`), `node_modules` installed
  on the host (`@resvg/resvg-js`), `receiver.js`, `router.js`.
- `/var/lib/usage-server` — data directory, seeded from 0.177's
  `/var/lib/usage-server` (logs excluded) and kept in sync.
- `/etc/sub2agent/billing-signing.key` — the same HMAC key as 0.177 (0600), so
  client-signed report requests verify on both hosts.
- `/etc/sub2agent/usage-server.env` (0600) — service environment:
  `USAGE_SERVER_PORT=17890`, host `127.0.0.1`, data dir, key file, ingest
  token, admin token (carried from 0.177), icon dir, font settings.
- `/etc/sub2agent/usage-sync.env`, `/etc/sub2agent/usage-sync.token` (0600) —
  sync receiver/pusher bearer token.
- systemd units: `usage-router.service` (public 0.0.0.0:5173),
  `usage-server.service` (127.0.0.1:17890), `usage-sync-receiver.service`
  (127.0.0.1:5174). All three must be active; `png_available: true` in
  `/healthz` proves fonts and resvg work.

## Request routing on 5173

`router.js` splits one security-group-opened port: `/sync`, `/seed`,
`/push-chunk`, `/push-complete`, `/push-status`, `/receiver-healthz` go to the
sync receiver; everything else goes to the billing server. The billing server
and the receiver are loopback-only; 5173 is their only public surface.

## Sync channel (0.177 → 134)

Direct egress from 0.177 to 134:22/5174 is blocked, and 0.177 reaches the
internet through a corporate forward proxy with an unstable egress IP that
also caps HTTP bodies (~1.5 MB observed). The channel therefore:

- runs on the same public 5173 port, token-protected (`/etc/sub2agent/usage-sync.token`),
- transfers every payload as 512 KB chunks (`/push-chunk`), resuming from the
  receiver's part list (`/push-status`) across runs,
- finishes with `/push-complete`, which concatenates parts, verifies the
  sha256 sent by the client, and only then extracts:
  - `type=sync` — atomically moves each file into `/var/lib/usage-server`
    (`mv` within one filesystem; the stores re-read by mtime per request, so
    no restart is needed),
  - `type=seed` — stages under `/var/lib/usage-migrate/seed-<ts>` for the
    one-time installer.

On 0.177 (all operations per the [AGENTS.md 0.177 protocol](../../../AGENTS.md):
wecli test-jump → `ssh eddiewang@172.21.0.177` → `sudo su - root`; outbound
via root's login-environment proxy, which the `bash -lc` cron wrappers rely
on):

- `/usr/local/sbin/usage-sync-push sync` — every 15 minutes: current-day
  legacy JSONL, the whole `minute-summaries/` directory, pricing, billing
  policy, report currency and mail preferences.
- `/usr/local/sbin/usage-sync-push full` — Sundays 03:00: the entire data
  directory minus logs, reconciling any drift.
- Crontab lines log to `/var/log/usage-sync.log`; `flock` prevents overlap.

Client-side identity: the desktop's default report URL and the intranet
collector stay on 0.177. Only consumers of bills (users, chat bots) switch to
`http://134.175.165.190:5173/`. Signed requests work unchanged on both hosts
because they share the signing key.

## Verification (2026-11-19)

- `GET /healthz` through the public port returns `ok:true`,
  `sub2agent-usage/3`, `png_available:true`, 18 users.
- Unsigned `GET /users` returns 401 on 134 (and 0.177); signed requests
  return 200; daily `.json` and `.svg` reports render on 134.
- `minute-summaries/summaries-20261118.jsonl` sha256 is identical on both
  hosts (`98acb4b7…`); report JSON hashes differ only by generation
  timestamps, so file-level hashes are the comparison basis.
- Three consecutive cron syncs applied with sha verification (`sync applied:
  … (sha ok)` in the receiver journal).

## Rollback

`systemctl disable --now usage-server usage-router` on 134 removes the public
service; 0.177 is untouched throughout. Remove the sync crontab lines on
0.177 to stop the feed. The receiver and router units can stay disabled
without affecting 0.177.
