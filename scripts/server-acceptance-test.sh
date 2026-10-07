#!/usr/bin/env bash
# Acceptance test for 墨排 on cc-tokyo-01.
# Runs ON the server: authenticates against the app via the Cloudflare Access
# identity headers so the full app + R2 chain is exercised without a browser.
set -uo pipefail

APP="http://127.0.0.1:3100"
EMAILDOMAIN="yoru-and-akari.dev"
ACCESS_EMAIL="${ACCESS_ALLOW_EMAIL:?set ACCESS_ALLOW_EMAIL to the Access allowlist email}"

ACCESS_KEY=$(sudo grep '^ACCESS_KEY=' /opt/mopai/app/.env | cut -d= -f2-)
echo "access key loaded (len=${#ACCESS_KEY})"

H_ACCESS=(-H "Cf-Access-Authenticated-User-Email: $ACCESS_EMAIL" -H "Cf-Access-Jwt-Assertion: test")

echo
echo "### 1. app reachable, SPA fallback"
for p in / /login; do
  code=$(curl -4 -sS -m 10 -o /dev/null -w '%{http_code}' -H 'Accept: text/html' "$APP$p")
  echo "  $p -> $code"
done

echo
echo "### 2. auth.me anonymous (expect json null)"
curl -4 -sS -m 10 "$APP/api/trpc/auth.me" | head -c 200; echo

echo
echo "### 3. wrong access key rejected"
curl -4 -sS -m 10 -X POST -H 'Content-Type: application/json' \
  -d '{"json":{"accessKey":"definitely-wrong"}}' "$APP/api/trpc/auth.login" | head -c 200; echo

echo
echo "### 4. login with real access key"
COOKIE_JAR=$(mktemp)
curl -4 -sS -m 10 -c "$COOKIE_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"accessKey\":\"$ACCESS_KEY\"}}" "$APP/api/trpc/auth.login" | head -c 200; echo
echo "  cookie set: $(grep -c mopai_sid "$COOKIE_JAR" || true)"

echo
echo "### 5. auth.me with session"
curl -4 -sS -m 10 -b "$COOKIE_JAR" "$APP/api/trpc/auth.me" | head -c 260; echo

echo
echo "### 6. upload an image"
PNG_B64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
UP=$(curl -4 -sS -m 30 -b "$COOKIE_JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"name\":\"acceptance.png\",\"contentBase64\":\"$PNG_B64\",\"contentType\":\"image/png\"}}" \
  "$APP/api/trpc/storage.upload")
echo "  $UP"
KEY=$(printf '%s' "$UP" | python3 -c 'import sys,json,re; m=re.search(r"\"key\":\"([^\"]+)\"", sys.stdin.read()); print(m.group(1) if m else "")')
echo "  key = $KEY"

echo
echo "### 7. storage.list shows the row"
curl -4 -sS -m 10 -b "$COOKIE_JAR" "$APP/api/trpc/storage.list" | head -c 400; echo

echo
echo "### 8. /api/img/<key> redirects, target returns 200"
if [ -n "$KEY" ]; then
  LOC=$(curl -4 -sS -m 15 -o /dev/null -w '%{redirect_url}' "$APP/api/img/$KEY")
  echo "  302 -> $LOC"
  echo "  final: $(curl -4 -sS -m 20 -o /dev/null -w 'status=%{http_code} type=%{content_type} bytes=%{size_download}' "$LOC")"
  echo "$KEY" > /tmp/mopai-test-key
fi

echo
echo "### 9. upload without session is refused (the gate)"
curl -4 -sS -m 15 -X POST -H 'Content-Type: application/json' \
  -d "{\"json\":{\"name\":\"nope.png\",\"contentBase64\":\"$PNG_B64\",\"contentType\":\"image/png\"}}" \
  "$APP/api/trpc/storage.upload" | head -c 260; echo

rm -f "$COOKIE_JAR"
echo
echo "### done"
