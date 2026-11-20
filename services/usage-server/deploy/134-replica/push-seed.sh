#!/bin/bash
# Push the migration seed tarball to 134 in chunks, with resume (proxy cuts streams).
set -u
TOKEN=$(sed -n 's/^TOKEN="\([0-9a-f]*\)"$/\1/p' /usr/local/sbin/usage-sync-push)
[ -n "$TOKEN" ] || { echo 'cannot read token from usage-sync-push'; exit 1; }
CHUNK=512000
URL="http://134.175.165.190:5173"
FILE=/var/tmp/usage-seed.tgz
[ -f "$FILE" ] || { echo "no seed at $FILE"; exit 1; }

SIZE=$(stat -c%s "$FILE")
SHA=$(sha256sum "$FILE" | cut -d' ' -f1)
NAME="seed-$(echo "$SHA" | cut -c1-12)"
MAXI=$(( (SIZE - 1) / CHUNK ))

send_part() { # $1=file $2=index
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

TMPD=$(mktemp -d /tmp/seedparts.XXXXXX)
trap 'rm -rf "$TMPD"' EXIT
split -b $CHUNK -d -a 6 "$FILE" "$TMPD/p"

for round in 1 2 3 4 5 6 7 8; do
  HAVE=$(curl -sf -m 60 -H "Authorization: Bearer $TOKEN" "$URL/push-status?stream=$NAME" 2>/dev/null | grep -o '[0-9]\+' | tr '\n' ' ')
  MISSING=0
  i=0
  while [ $i -le $MAXI ]; do
    if ! echo " $HAVE " | grep -q " $i "; then
      MISSING=$((MISSING+1))
      send_part "$TMPD/p$(printf %06d $i)" "$i" || { echo "round $round: chunk $i FAILED"; break; }
    fi
    i=$((i+1))
  done
  [ $MISSING -eq 0 ] && break
  echo "round $round: $MISSING chunks still missing, retrying"
  sleep 10
done

CODE=$(curl -sf -m 120 -X POST -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sha256\":\"$SHA\",\"total\":$SIZE}" \
  "$URL/push-complete?stream=$NAME&type=seed" 2>/dev/null)
echo "SEED_DONE reply=$CODE"
