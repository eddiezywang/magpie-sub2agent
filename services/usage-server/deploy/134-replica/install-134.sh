#!/bin/bash
# One-time installer on 134: moves the received seed into its final places,
# writes /etc/sub2agent/usage-server.env, installs fonts, then starts both services.
# Run AFTER the seed upload (POST /seed) has completed.
set -eu
SEED=$(ls -d /var/lib/usage-migrate/seed-* 2>/dev/null | sort | tail -1)
[ -n "$SEED" ] || { echo "no seed found in /var/lib/usage-migrate"; exit 1; }
echo "installing from $SEED"

mkdir -p /etc/sub2agent /var/lib/usage-server /opt/usage-server

# 1. billing HMAC signing key (same key as 0.177 so client signatures verify)
if [ -f "$SEED/etc-sub2agent/billing-signing.key" ]; then
  install -m 600 -o root -g root "$SEED/etc-sub2agent/billing-signing.key" /etc/sub2agent/billing-signing.key
  echo "key installed"
fi

# 2. fonts provided by the 0.177 deployment
if [ -d "$SEED/opt-fonts" ]; then
  mkdir -p /opt/usage-server/assets/fonts
  cp -a "$SEED/opt-fonts/." /opt/usage-server/assets/fonts/
  echo "fonts installed"
fi

# 3. build the service env: carry over admin token + font settings from the 0.177 unit files,
#    add the new public-ingest token and fixed paths for this host.
ADMIN_TOKEN=""
FONT_FILE=""
FONT_FAMILY=""
for f in "$SEED"/systemd/*; do
  [ -f "$f" ] || continue
  v=$(grep -oE 'USAGE_SERVER_ADMIN_TOKEN="?[A-Za-z0-9_-]+' "$f" | head -1 | sed 's/.*TOKEN="?//')
  [ -n "$v" ] && ADMIN_TOKEN="$v"
  v=$(grep -oE 'USAGE_SERVER_FONT_FILE="?[^ "]+' "$f" | head -1 | sed 's/.*FILE="?//')
  [ -n "$v" ] && FONT_FILE="$v"
  v=$(grep -oE 'USAGE_SERVER_FONT_FAMILY="?[^ "]+' "$f" | head -1 | sed 's/.*FAMILY="?//')
  [ -n "$v" ] && FONT_FAMILY="$v"
done
if [ -z "$ADMIN_TOKEN" ]; then echo "WARNING: no admin token found in seed systemd files"; fi
cat > /etc/sub2agent/usage-server.env <<EOF
USAGE_SERVER_PORT=17890
USAGE_SERVER_HOST=127.0.0.1
USAGE_SERVER_DATA_DIR=/var/lib/usage-server
USAGE_SERVER_BILLING_KEY_FILE=/etc/sub2agent/billing-signing.key
USAGE_SERVER_TOKEN=$INGEST_TOKEN
USAGE_SERVER_ADMIN_TOKEN=$ADMIN_TOKEN
USAGE_SERVER_ICON_DIR=/opt/usage-server/assets/icons-pixel
USAGE_SERVER_FONT_FILE=$FONT_FILE
USAGE_SERVER_FONT_FAMILY=$FONT_FAMILY
EOF
chmod 600 /etc/sub2agent/usage-server.env
[ -n "$SYNC_TOKEN" ] && { printf %s "$SYNC_TOKEN" > /etc/sub2agent/usage-sync.token; chmod 600 /etc/sub2agent/usage-sync.token; printf 'USAGE_SYNC_TOKEN=%s\n' "$SYNC_TOKEN" > /etc/sub2agent/usage-sync.env; chmod 600 /etc/sub2agent/usage-sync.env; }
echo "env written (provide INGEST_TOKEN, SYNC_TOKEN via environment before running)"

# 4. data directory from the seed (tar root is var-lib-usage-server/)
if [ -d "$SEED/var-lib-usage-server" ]; then
  cp -a "$SEED/var-lib-usage-server/." /var/lib/usage-server/
  echo "data installed"
fi

systemctl daemon-reload
systemctl enable --now usage-server.service
sleep 1
systemctl --no-pager -l status usage-server.service | head -12
curl -s http://127.0.0.1:5173/healthz || echo "HEALTHZ FAILED"
