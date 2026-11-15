#!/usr/bin/env bash
set -euo pipefail
# Run from a prepared release's service directory, after checking port ownership.
cd -- "$(dirname -- "$0")"
bash install.sh
python_bin=${PYTHON_BIN:-python3}
for name in workbuddy aiep codebuddy trae native-api community-antigravity community-commandcode community-cursor community-devin community-factory community-grok community-kiro community-mimo community-qoder community-workbuddy community-zcode community-zed notify; do
  plugin="../staging/$name"
  version=$("$python_bin" -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$plugin/package.json")
  "$python_bin" /opt/sub2agent-plugin-market/bin/publish.py \
    --root /opt/sub2agent-plugin-market/www --plugin "$plugin" \
    --version "$version" --summary "内部维护的 $name 插件"
done
"$python_bin" /opt/sub2agent-plugin-market/bin/check.py --base http://127.0.0.1:18989
