#!/usr/bin/env bash
set -euo pipefail
# Run from a prepared release's service directory, after checking port ownership.
cd -- "$(dirname -- "$0")"
bash install.sh
for name in codebuddy workbuddy trae aiep notify; do
  plugin="../staging/$name"
  version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$plugin/package.json")
  python3 /opt/sub2agent-plugin-market/bin/publish.py \
    --root /opt/sub2agent-plugin-market/www --plugin "$plugin" \
    --version "$version" --summary "内部维护的 $name 插件"
done
python3 /opt/sub2agent-plugin-market/bin/check.py --base http://127.0.0.1
