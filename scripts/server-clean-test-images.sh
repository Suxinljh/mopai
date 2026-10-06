#!/usr/bin/env bash
# Remove acceptance-test images from R2 and the SQLite ledger.
set -uo pipefail

ENV_FILE=/opt/mopai/app/.env
IMG_BASE=$(sudo grep '^IMG_BASE_URL=' "$ENV_FILE" | cut -d= -f2-)
ADMIN_KEY=$(sudo grep '^IMG_ADMIN_KEY=' "$ENV_FILE" | cut -d= -f2-)

echo "== matching rows =="
sudo -u mopai node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/opt/mopai/app/data/mopai.db");
const rows = db.prepare("select key from files where key like ?").all("%acceptance%");
for (const r of rows) console.log(r.key);
' > /tmp/mopai-testkeys

if [ ! -s /tmp/mopai-testkeys ]; then echo "nothing to clean"; exit 0; fi
cat /tmp/mopai-testkeys

echo "== delete from R2 =="
while read -r key; do
  [ -z "$key" ] && continue
  code=$(curl -4 -sS -m 20 -o /dev/null -w '%{http_code}' -X DELETE \
    -H "X-Admin-Key: $ADMIN_KEY" \
    "$IMG_BASE/api/upload?key=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$key")")
  echo "  $key -> $code"
done < /tmp/mopai-testkeys

echo "== delete from sqlite =="
sudo -u mopai node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/opt/mopai/app/data/mopai.db");
const res = db.prepare("delete from files where key like ?").run("%acceptance%");
console.log("  rows deleted:", res.changes);
console.log("  rows remaining:", db.prepare("select count(*) c from files").get().c);
'
rm -f /tmp/mopai-testkeys
echo done
