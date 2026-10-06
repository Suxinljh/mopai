#!/usr/bin/env bash
# Round-2 acceptance on the host: cross-device 稿件, storage stats, orphan cleanup,
# and the carousel-ratio markdown round trip.
#
# `set -e` matters here: without it a failed assertion still reaches the final
# "PASSED" line and the run looks green when nothing worked.
set -euo pipefail

APP="http://127.0.0.1:3100"
ENV_FILE=/opt/mopai/app/.env
ACCESS_KEY=$(sudo grep '^ACCESS_KEY=' "$ENV_FILE" | cut -d= -f2-)

COOKIE_HDR=$(mktemp)
COOKIE=""
trap 'rm -f "$COOKIE_HDR"' EXIT
# The session cookie is Secure, so curl's cookie jar drops it over plain HTTP.
# Capture the header and send it back by hand instead.
post() { curl -4 -sS -m 30 -H "Cookie: $COOKIE" -X POST -H 'Content-Type: application/json' -d "$2" "$APP/api/trpc/$1"; }
get()  { curl -4 -sS -m 30 -H "Cookie: $COOKIE" "$APP/api/trpc/$1"; }
# A tRPC error still comes back as HTTP 200, so refuse anything without a result envelope.
must() { python3 -c '
import sys, json
d = json.load(sys.stdin)
if "error" in d:
    raise SystemExit("trpc error: %s" % json.dumps(d["error"], ensure_ascii=False)[:300])
if "result" not in d:
    raise SystemExit("no result envelope: %s" % json.dumps(d, ensure_ascii=False)[:300])
print(json.dumps(d["result"]["data"]["json"], ensure_ascii=False))
'; }

echo "=== schema ==="
sudo -u mopai node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("/opt/mopai/app/data/mopai.db");
const t = db.prepare("select name from sqlite_master where type=? order by name").all("table").map(r => r.name);
console.log("  tables: " + t.join(", "));
if (!t.includes("docs") || !t.includes("files")) throw new Error("expected both tables");
' 2>&1 | grep -v Warning || true

echo
echo "=== login ==="
curl -4 -sS -m 30 -D "$COOKIE_HDR" -o /dev/null -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"accessKey\":\"$ACCESS_KEY\"}}" "$APP/api/trpc/auth.login"
COOKIE=$(grep -i '^set-cookie:' "$COOKIE_HDR" | sed -E 's/^[Ss]et-[Cc]ookie: *([^;]+).*/\1/' | tr -d '\r')
if [ -z "$COOKIE" ]; then echo "  LOGIN FAILED: no session cookie returned"; exit 1; fi
echo "  session cookie captured (${#COOKIE} chars)"
get auth.me | must | python3 -c 'import sys,json; r=json.load(sys.stdin); print("  auth.me name:", r["name"] if r else None); assert r'

echo
echo "=== pre-clean leftovers from an earlier interrupted run ==="
# This script must be re-runnable: a previous run that died mid-way would
# otherwise leave rows behind and break the row-count assertions below.
post docs.remove '{"json":{"id":"acc-1"}}' | must >/dev/null
post docs.remove '{"json":{"id":"acc-2"}}' | must >/dev/null
get docs.list | must | python3 -c '
import sys, json
rows = [r for r in json.load(sys.stdin) if r["id"].startswith("acc-")]
assert not rows, rows
print("  clean start")
'

echo
echo "=== docs CRUD ==="
post docs.save '{"json":{"id":"acc-1","name":"验收稿","content":"# 一\n","updatedAt":1791310000000}}' | must >/dev/null
post docs.save '{"json":{"id":"acc-1","name":"验收稿改名","content":"# 二\n","updatedAt":1791310001000}}' | must >/dev/null
get docs.list | must | python3 -c '
import sys, json
# Only look at this script own rows: the app seeds a demo 稿件 into an empty
# database, so a global row count is not ours to assert on.
mine = [r for r in json.load(sys.stdin) if r["id"].startswith("acc-")]
print("  acc- rows=%d name=%s" % (len(mine), mine[0]["name"]))
assert len(mine) == 1 and mine[0]["name"] == "验收稿改名", "upsert did not update in place"
print("  upsert-in-place OK")
'
post docs.importLocal '{"json":{"docs":[{"id":"acc-1","name":"旧","content":"x","updatedAt":1},{"id":"acc-2","name":"新的","content":"y","updatedAt":2}]}}' \
  | must | python3 -c 'import sys,json; n=json.load(sys.stdin)["imported"]; print("  importLocal imported:", n); assert n == 1'

echo
echo "=== carousel ratio survives a save/load round trip ==="
post docs.save '{"json":{"id":"acc-1","name":"轮播稿","content":":::carousel 16:9 宽幅演示\n![A]()\n![B]()\n:::\n","updatedAt":1791310002000}}' | must >/dev/null
get docs.list | must | python3 -c '
import sys, json
row = [r for r in json.load(sys.stdin) if r["id"] == "acc-1"][0]
assert ":::carousel 16:9" in row["content"], row["content"]
print("  ratio line stored verbatim:", row["content"].splitlines()[0])
'

echo
echo "=== storage stats + orphan cleanup ==="
# Earlier checks in verify-all.sh leave their own images behind, so assert on
# deltas rather than absolute totals.
BASE_FILES=$(get storage.stats | must | python3 -c 'import sys,json; print(json.load(sys.stdin)["count"])')
BASE_ORPHANS=$(get storage.orphans | must | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')
echo "  baseline: files=$BASE_FILES orphans=$BASE_ORPHANS"

PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
for n in keep drop; do
  K=$(post storage.upload "{\"json\":{\"name\":\"$n.png\",\"contentBase64\":\"$PNG\",\"contentType\":\"image/png\"}}" \
      | must | python3 -c 'import sys,json; print(json.load(sys.stdin)["key"])')
  echo "  uploaded $n -> $K"
  if [ "$n" = keep ]; then
    post docs.save "{\"json\":{\"id\":\"acc-1\",\"name\":\"引用稿\",\"content\":\"img:$K\",\"updatedAt\":1791310003000}}" | must >/dev/null
  fi
done
get storage.stats | must | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('  stats: count=%s bytes=%s quota=%s' % (r['count'], r['totalBytes'], r['quotaBytes']))
assert r['count'] == $BASE_FILES + 2, r
"
get storage.orphans | must | python3 -c "
import sys, json
rows = json.load(sys.stdin)
print('  orphans: %d (baseline %d + the one we just left unreferenced)' % (len(rows), $BASE_ORPHANS))
assert len(rows) == $BASE_ORPHANS + 1, rows
"
KEYS=$(get storage.orphans | must | python3 -c 'import sys, json; print(json.dumps([r["key"] for r in json.load(sys.stdin)]))')
post storage.removeOrphans "{\"json\":{\"keys\":$KEYS}}" | must | python3 -c "
import sys, json
r = json.load(sys.stdin)
print('  cleaned: deleted=%s freed=%s' % (r['deleted'], r['freedBytes']))
assert r['deleted'] == $BASE_ORPHANS + 1, r
assert r['freedBytes'] == 70 * ($BASE_ORPHANS + 1), r
"

echo
echo "=== teardown ==="
post docs.remove '{"json":{"id":"acc-1"}}' | must >/dev/null
post docs.remove '{"json":{"id":"acc-2"}}' | must >/dev/null
ALL=$(get storage.list | must | python3 -c 'import sys, json; print(json.dumps([r["key"] for r in json.load(sys.stdin)]))')
post storage.removeOrphans "{\"json\":{\"keys\":$ALL}}" | must >/dev/null
get storage.stats | must | python3 -c 'import sys,json; n=json.load(sys.stdin)["count"]; print("  files left:", n); assert n == 0'
get docs.list  | must | python3 -c 'import sys,json; n=len(json.load(sys.stdin)); print("  docs left:", n); assert n == 0'
echo ROUND-2 ACCEPTANCE PASSED
