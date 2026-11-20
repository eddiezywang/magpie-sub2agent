#!/bin/bash
# Build the one-time migration seed tarball on 0.177 (root required).
# Structure: var-lib-usage-server/ (data, no logs), etc-sub2agent/billing-signing.key,
# systemd/ (unit + drop-ins), opt-fonts/ (receipt fonts).
set -eu
ST=$(mktemp -d /tmp/seedstage.XXXXXX)
trap 'rm -rf "$ST"' EXIT
mkdir -p "$ST/var-lib-usage-server" "$ST/etc-sub2agent" "$ST/systemd" "$ST/opt-fonts"
cp -al /var/lib/usage-server/. "$ST/var-lib-usage-server/"
rm -rf "$ST/var-lib-usage-server/logs"
cp -a /etc/sub2agent/billing-signing.key "$ST/etc-sub2agent/"
cp -a /etc/systemd/system/usage-server.service "$ST/systemd/"
[ -d /etc/systemd/system/usage-server.service.d ] && cp -a /etc/systemd/system/usage-server.service.d "$ST/systemd/"
cp -a /opt/usage-server/assets/fonts/. "$ST/opt-fonts/"
OUT=/tmp/usage-seed.tgz
tar czf "$OUT" -C "$ST" .
echo "SIZE $(stat -c%s "$OUT")"
sha256sum "$OUT"
