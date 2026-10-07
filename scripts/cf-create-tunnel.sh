#!/usr/bin/env bash
# Create the mopai tunnel + DNS record, and print the pieces the server needs.
# Idempotent: reuses an existing tunnel of the same name.
set -uo pipefail
set -a; source $HOME/.config/codex/private.env 2>/dev/null; set +a

ACC=5e96dfd2bf22d385e4ffdaa794d74676
ZONE=4f9b5c7236e63090439676eec70031e2
NAME=mopai
HOST=wechat.yoru-and-akari.dev
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"

echo "=== existing tunnels ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/cfd_tunnel?is_deleted=false" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); [print("  ", t["id"], t["name"], t["status"]) for t in d.get("result",[])]'

echo "=== look for an existing '$NAME' tunnel ==="
EXISTING=$(curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/cfd_tunnel?is_deleted=false&name=$NAME" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("result") or []; print(r[0]["id"] if r else "")')

if [ -n "$EXISTING" ]; then
  TUNNEL_ID="$EXISTING"
  echo "reusing tunnel: $TUNNEL_ID"
else
  SECRET=$(openssl rand -base64 32)
  echo "creating tunnel '$NAME'"
  TUNNEL_ID=$(curl -4 -sS -m 30 -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"name\":\"$NAME\",\"tunnel_secret\":\"$SECRET\",\"config_src\":\"local\"}" \
    "https://api.cloudflare.com/client/v4/accounts/$ACC/cfd_tunnel" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print((d.get("result") or {}).get("id",""))')
  if [ -z "$TUNNEL_ID" ]; then echo "TUNNEL CREATE FAILED"; exit 1; fi
  echo "created tunnel: $TUNNEL_ID"
  echo "$SECRET" > /tmp/mopai-tunnel-secret
fi

echo "=== DNS record for $HOST ==="
EXISTING_DNS=$(curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records?name=$HOST" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); r=d.get("result") or []; print(r[0]["id"] if r else "")')

TARGET="$TUNNEL_ID.cfargotunnel.com"
if [ -n "$EXISTING_DNS" ]; then
  echo "DNS exists ($EXISTING_DNS), updating to $TARGET"
  curl -4 -sS -m 30 -X PUT -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"type\":\"CNAME\",\"name\":\"$HOST\",\"content\":\"$TARGET\",\"proxied\":true,\"ttl\":1}" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records/$EXISTING_DNS" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  ok" if d.get("success") else d.get("errors"))'
else
  echo "creating DNS CNAME -> $TARGET"
  curl -4 -sS -m 30 -X POST -H "$AUTH" -H "Content-Type: application/json" \
    -d "{\"type\":\"CNAME\",\"name\":\"$HOST\",\"content\":\"$TARGET\",\"proxied\":true,\"ttl\":1}" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE/dns_records" \
    | python3 -c 'import sys,json; d=json.load(sys.stdin); print("  ok" if d.get("success") else d.get("errors"))'
fi

echo "TUNNEL_ID=$TUNNEL_ID"
