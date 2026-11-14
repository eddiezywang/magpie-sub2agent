#!/usr/bin/env bash
set -euo pipefail
# Install only into the named directory; refuse to replace an existing listener.
root=/opt/sub2agent-plugin-market
python_bin=${PYTHON_BIN:-$(command -v python3)}
if [[ ! -f /etc/systemd/system/sub2agent-plugin-market.service ]] && ss -lnt | awk '{print $4}' | grep -Eq '(^|:)18989$'; then
  echo 'Port 18989 is occupied. Configure an existing reverse proxy before deploying.' >&2
  exit 1
fi
install -d -m 755 "$root/bin" "$root/www/magpie/plugins/dist" "$root/www/npm"
install -m 644 serve.py publish.py check.py "$root/bin/"
if [[ ! -f "$root/www/magpie/plugins/registry.json" ]]; then
  printf '{"version":1,"plugins":[]}\n' > "$root/www/magpie/plugins/registry.json"
fi
install -m 644 index.html "$root/www/index.html"
cat > /etc/systemd/system/sub2agent-plugin-market.service <<EOF
[Unit]
Description=Sub2Agent intranet plugin marketplace
After=network.target
[Service]
ExecStart=$python_bin $root/bin/serve.py --root $root/www --port 18989
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=full
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable sub2agent-plugin-market.service
systemctl restart sub2agent-plugin-market.service
sleep 1
curl --fail --max-time 5 http://127.0.0.1:18989/healthz
echo
