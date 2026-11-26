#!/bin/sh
# AAB Field -> QNAP: copy approved weekly reports and their photos into the
# project folders. Safe to run any number of times: it only downloads files
# that are missing or have changed size, and it never deletes anything.
#
# Setup (QNAP, admin over SSH):
#   1. Put this file in an admin-only share, e.g. /share/Admin/aab-field/qnap-sync.sh
#   2. Set KEY below to the app's ARCHIVE_KEY, and DEST to the share the project
#      folders live in (paths from the app are relative to it).
#   3. Nightly at 1:30 AM:
#        echo '30 1 * * * /bin/sh /share/Admin/aab-field/qnap-sync.sh' >> /etc/config/crontab
#        crontab /etc/config/crontab && /etc/init.d/crond.sh restart
URL="${AAB_URL:-https://cm.aabeng.com}"
KEY="${AAB_KEY:-PASTE_ARCHIVE_KEY_HERE}"
DEST="${AAB_DEST:-/share/Projects}"
LOG="$DEST/CM Archive/_sync.log"

mkdir -p "$DEST/CM Archive"
TMP="$DEST/CM Archive/.manifest.$$"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

if ! curl -fsS --retry 3 -H "X-Archive-Key: $KEY" "$URL/archive/manifest.txt" -o "$TMP"; then
  log "ERROR could not get the file list from $URL"; rm -f "$TMP"; exit 1
fi
new=0; fail=0
while IFS='|' read -r rel src bytes; do
  [ -z "$rel" ] && continue
  out="$DEST/$rel"
  if [ -f "$out" ] && [ "$(stat -c %s "$out" 2>/dev/null)" = "$bytes" ]; then continue; fi
  mkdir -p "$(dirname "$out")"
  if curl -fsS --retry 3 -H "X-Archive-Key: $KEY" "$URL$src" -o "$out.part" && [ "$(stat -c %s "$out.part")" = "$bytes" ]; then
    mv -f "$out.part" "$out"; new=$((new + 1))
  else
    rm -f "$out.part"; fail=$((fail + 1)); log "ERROR $rel"
  fi
done < "$TMP"
rm -f "$TMP"
log "done: $new new or updated, $fail failed"
