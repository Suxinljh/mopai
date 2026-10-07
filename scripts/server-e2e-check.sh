#!/usr/bin/env bash
# End-to-end proof of the objective's image criterion:
#   upload an image -> public /api/img/<key> -> 302 -> 200 image/png
# Prints the public result and cleans up after itself.
set -uo pipefail

APP="http://127.0.0.1:3100"
PUBLIC="https://wechat.yoru-and-akari.dev"
ENV_FILE=/opt/mopai/app/.env

ACCESS_KEY=$(sudo grep '^ACCESS_KEY=' "$ENV_FILE" | cut -d= -f2-)
IMG_BASE=$(sudo grep '^IMG_BASE_URL=' "$ENV_FILE" | cut -d= -f2-)
ADMIN_KEY=$(sudo grep '^IMG_ADMIN_KEY=' "$ENV_FILE" | cut -d= -f2-)

JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

echo "== login =="
curl -4 -sS -m 15 -c "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"accessKey\":\"$ACCESS_KEY\"}}" "$APP/api/trpc/auth.login" | head -c 80; echo

echo "== upload =="
PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
RESP=$(curl -4 -sS -m 30 -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"name\":\"final-check.png\",\"contentBase64\":\"$PNG\",\"contentType\":\"image/png\"}}" \
  "$APP/api/trpc/storage.upload")
KEY=$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["data"]["json"]["key"])')
echo "  key = $KEY"

echo "== public fetch of the address that lands in copied HTML =="
echo "  $PUBLIC/api/img/$KEY"
CODE=$(curl -4 -sS -m 25 -o /dev/null -w '%{http_code}' "$PUBLIC/api/img/$KEY")
FINAL=$(curl -4 -sS -m 25 -L -o /dev/null -w '%{http_code} %{content_type} %{size_download}B' "$PUBLIC/api/img/$KEY")
echo "  first response : $CODE (expect 302)"
echo "  after redirect : $FINAL (expect 200 image/png 70B)"

echo "== cleanup =="
curl -4 -sS -m 20 -o /dev/null -w "  worker delete -> %{http_code}\n" -X DELETE \
  -H "X-Admin-Key: $ADMIN_KEY" \
  "$IMG_BASE/api/upload?key=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$KEY")"
sudo -u mopai node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/opt/mopai/app/data/mopai.db");
db.prepare("delete from files where key = ?").run(process.argv[1]);
console.log("  ledger rows remaining:", db.prepare("select count(*) c from files").get().c);
' "$KEY"
curl -4 -sS -m 20 -o /dev/null -w "  after delete -> %{http_code} (expect 404)\n" "$PUBLIC/api/img/$KEY"
