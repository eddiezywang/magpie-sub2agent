#!/bin/bash
# Signed bill fetcher on 134.175.165.190 — reads the root-only signing key on this host.
# Usage:
#   bill <user>                      daily.json  -> stdout
#   bill <user> 2026-11-18           daily.json for that date
#   bill <user> 2026-11-18 svg       daily.svg   -> stdout
#   bill <user> 2026-11-18 png       daily.png   -> /tmp/bill-<user>-<date>.png
# Same signing scheme as 0.177 (see DEPLOYMENT-134.md / accounting.md).
set -eu
KEYFILE=/etc/sub2agent/billing-signing.key
BASE=http://127.0.0.1:5173
USER_="${1:?usage: bill <user> [date] [json|svg|png]}"
DATE="${2:-$(date +%F)}"
FMT="${3:-json}"
case "$FMT" in json|svg|png) ;; *) echo "format: json|svg|png" >&2; exit 1;; esac

TARGET="/reports/$USER_/daily.$FMT?date=$DATE"
TS=$(date +%s%3N)
NONCE=$(openssl rand -hex 16)
HEXKEY=$(cat "$KEYFILE")
SIG=$(printf 'sub2agent-billing-v1\nGET\n%s\n%s\n%s' "$TARGET" "$TS" "$NONCE" \
  | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$HEXKEY" -hex | awk '{print $NF}')

CODE=$(curl -s -o /tmp/bill.out -w '%{http_code}' \
  -H "x-sub2agent-timestamp: $TS" \
  -H "x-sub2agent-nonce: $NONCE" \
  -H "x-sub2agent-signature: $SIG" \
  "$BASE$TARGET")
if [ "$CODE" != 200 ]; then cat /tmp/bill.out; echo; echo "HTTP $CODE" >&2; exit 1; fi
if [ "$FMT" = png ]; then
  OUT="/tmp/bill-${USER_}-${DATE}.png"
  mv /tmp/bill.out "$OUT" && echo "$OUT"
else
  cat /tmp/bill.out; echo
fi
