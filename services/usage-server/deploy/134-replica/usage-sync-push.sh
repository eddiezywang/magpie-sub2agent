#!/bin/bash
# Push usage data from 0.177 to the 134 replica over HTTP, chunked with resume.
# usage-sync-push sync : current-day files + minute-summaries + config JSONs (cron, every 15 min)
# usage-sync-push full : whole data dir minus logs (weekly reconciliation)
set -u
MODE="${1:-sync}"
TOKEN=$(cat /etc/sub2agent/usage-sync.token 2>/dev/null)
[ -n "$TOKEN" ] || { echo 'missing /etc/sub2agent/usage-sync.token (0600 root)'; exit 1; }
CHUNK=512000
URL="http://134.175.165.190:5173"
DATA=/var/lib/usage-server
TMP=$(mktemp /tmp/usage-sync.XXXXXX.tgz)
trap 'rm -rf "$TMP" "$TMP.d"' EXIT

cd "$DATA" || exit 1
if [ "$MODE" = "full" ]; then
  tar czf "$TMP" --exclude='logs' .
else
  TODAY=$(date +%F)
  FILES="telemetry-${TODAY}.jsonl minute-summaries pricing.json billing-policy.json report-currency.json mail-preferences.json billing-policies"
  for f in usage-*.jsonl; do [ -e "$f" ] && FILES="$FILES $f"; done
  tar czf "$TMP" $FILES 2>/dev/null || true
fi

SIZE=$(stat -c%s "$TMP")
SHA=$(sha256sum "$TMP" | cut -d' ' -f1)
NAME="${MODE}-$(date +%s)"
MAXI=$(( (SIZE - 1) / CHUNK ))
mkdir -p "$TMP.d"
split -b $CHUNK -d -a 6 "$TMP" "$TMP.d/p"

send_part() {
  local try
  for try in 1 2 3; do
    if curl -sf -m 120 -H "Authorization: Bearer $TOKEN" \
        --data-binary @"$1" "$URL/push-chunk?stream=$NAME&i=$2" >/dev/null 2>&1; then
      return 0
    fi
    sleep 5
  done
  return 1
}

for round in 1 2 3; do
  HAVE=$(curl -sf -m 60 -H "Authorization: Bearer $TOKEN" "$URL/push-status?stream=$NAME" 2>/dev/null | grep -o '[0-9]\+' | tr '\n' ' ')
  MISSING=0
  i=0
  while [ $i -le $MAXI ]; do
    if ! echo " $HAVE " | grep -q " $i "; then
      MISSING=$((MISSING+1))
      send_part "$TMP.d/p$(printf %06d $i)" "$i" || { echo "$(date '+%F %T') mode=$MODE round $round chunk $i FAILED"; break; }
    fi
    i=$((i+1))
  done
  [ $MISSING -eq 0 ] && break
  sleep 10
done

CODE=$(curl -sf -m 120 -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sha256\":\"$SHA\",\"total\":$SIZE}" \
  "$URL/push-complete?stream=$NAME&type=sync" 2>/dev/null)
RC=$?
echo "$(date '+%F %T') mode=$MODE size=$SIZE chunks=$((MAXI+1)) reply=$CODE"
exit 0
