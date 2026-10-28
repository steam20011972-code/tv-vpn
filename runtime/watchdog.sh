#!/bin/sh
BASE=/media/developer/tv-vpn
# As in the boot hook: nothing runs from BASE unless it, its runtime and the file are root's and not links.
root_owned() { [ ! -L "$1" ] && [ "$(stat -c %u "$1" 2>/dev/null)" = 0 ]; }
LEASE="$1"
SUPERVISOR="$2"
while [ -f "$BASE/run/lease.json" ]; do
  sleep 2
  grep -q '"id":"'"$LEASE"'"' "$BASE/run/lease.json" 2>/dev/null || exit
  read UP REST < /proc/uptime
  UP=${UP%%.*}
  HB=0
  [ -f "$BASE/run/heartbeat" ] && read HB < "$BASE/run/heartbeat"
  case "$HB" in ''|*[!0-9]*) HB=0;; esac
  if ! kill -0 "$SUPERVISOR" 2>/dev/null || [ $((UP - HB)) -gt 12 ]; then
    for F in "$BASE" "$BASE/runtime" "$BASE/runtime/recover.cjs" "$BASE/runtime/launch.cjs"; do
      root_owned "$F" || continue 2
    done
    /usr/bin/node "$BASE/runtime/recover.cjs" "$LEASE" || continue
    /usr/bin/node "$BASE/runtime/launch.cjs" resume >/dev/null 2>&1
    exit
  fi
done
