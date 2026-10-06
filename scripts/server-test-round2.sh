#!/usr/bin/env bash
# Exercise the round-2 features against the live app: docs CRUD, storage stats,
# orphan detection and cleanup.
set -uo pipefail

APP="http://127.0.0.1:3100"
ENV_FILE=/opt/mopai/app/.env
ACCESS_KEY=$(sudo grep '^ACCESS_KEY=' "$ENV_FILE" | cut -d= -f2-)

JAR=$(mktemp)
trap 'rm -f "$JAR"' EXIT

post() { curl -4 -sS -m 30 -b "$JAR" -X POST -H 'Content-Type: application/json' -d "$2" "$APP/api/trpc/$1"; }
get()  { curl -4 -sS -m 30 -b "$JAR" "$APP/api/trpc/$1"; }

echo "=== login ==="
post auth.login "{\"json\":{\"accessKey\":\"$ACCESS_KEY\"}}" | head -c 60; echo

echo
echo "=== docs.list on a fresh database ==="
get docs.list | head -c 120; echo

echo
echo "=== docs.save (one doc) ==="
DOC='{"json":{"id":"test-doc-1","name":"验收稿件","content":"# 标题\n\n:::carousel 4:3 测试\n![A](img:orphan-test.png)\n:::\n","updatedAt":1791300000000}}'
post docs.save "$DOC" | head -c 120; echo

echo
echo "=== docs.list now ==="
get docs.list | python3 -c '
import sys, json
d = json.load(sys.stdin)
rows = d["result"]["data"]["json"]
for r in rows:
    print("  id=%s name=%s updatedAt=%s" % (r["id"], r["name"], r["updatedAt"]))
'

echo
echo "=== docs.save again = update, not a duplicate ==="
DOC2='{"json":{"id":"test-doc-1","name":"验收稿件改过名","content":"# 改过了\n","updatedAt":1791300005000}}'
post docs.save "$DOC2" >/dev/null
get docs.list | python3 -c '
import sys, json
rows = json.load(sys.stdin)["result"]["data"]["json"]
print("  rows:", len(rows), "| name:", rows[0]["name"])
'

echo
echo "=== docs.importLocal (migration path) ==="
IMP='{"json":{"docs":[{"id":"test-doc-1","name":"已有的","content":"x","updatedAt":1},{"id":"test-doc-2","name":"新导入","content":"y","updatedAt":2}]}}'
post docs.importLocal "$IMP" | head -c 120; echo "   (expect imported=1: test-doc-1 already exists)"

echo
echo "=== upload two images, reference only one in the saved doc ==="
PNG='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
for n in used orphan; do
  K=$(post storage.upload "{\"json\":{\"name\":\"$n.png\",\"contentBase64\":\"$PNG\",\"contentType\":\"image/png\"}}" \
      | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["data"]["json"]["key"])')
  echo "  uploaded $n -> $K"
  if [ "$n" = "used" ]; then
    post docs.save "{\"json\":{\"id\":\"test-doc-1\",\"name\":\"验收稿件\",\"content\":\"引用 img:$K\",\"updatedAt\":1791300010000}}" >/dev/null
  fi
done

echo
echo "=== storage.stats ==="
get storage.stats | python3 -c '
import sys, json
r = json.load(sys.stdin)["result"]["data"]["json"]
print("  count=%s totalBytes=%s quotaBytes=%s" % (r["count"], r["totalBytes"], r["quotaBytes"]))
'

echo
echo "=== storage.orphans (expect exactly the unreferenced one) ==="
get storage.orphans | python3 -c '
import sys, json
rows = json.load(sys.stdin)["result"]["data"]["json"]
for r in rows:
    print("  orphan:", r["name"])
print("  orphan count:", len(rows))
'

echo
echo "=== removeOrphans ==="
KEYS=$(get storage.orphans | python3 -c '
import sys, json
rows = json.load(sys.stdin)["result"]["data"]["json"]
print(json.dumps([r["key"] for r in rows]))
')
post storage.removeOrphans "{\"json\":{\"keys\":$KEYS}}" | head -c 160; echo

echo
echo "=== stats after cleanup ==="
get storage.stats | python3 -c '
import sys, json
r = json.load(sys.stdin)["result"]["data"]["json"]
print("  count=%s totalBytes=%s" % (r["count"], r["totalBytes"]))
'

echo
echo "=== docs.remove + cleanup ==="
post docs.remove '{"json":{"id":"test-doc-1"}}' >/dev/null
post docs.remove '{"json":{"id":"test-doc-2"}}' >/dev/null
REM=$(get storage.list | python3 -c '
import sys, json
rows = json.load(sys.stdin)["result"]["data"]["json"]
print(json.dumps([r["key"] for r in rows]))
')
IDS=$(get docs.list | python3 -c '
import sys, json
print(len(json.load(sys.stdin)["result"]["data"]["json"]))
')
post storage.removeOrphans "{\"json\":{\"keys\":$REM}}" >/dev/null
echo "  docs remaining: $IDS"
get storage.stats | python3 -c '
import sys, json
r = json.load(sys.stdin)["result"]["data"]["json"]
print("  files remaining:", r["count"])
'
echo done
