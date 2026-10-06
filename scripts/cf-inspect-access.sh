#!/usr/bin/env bash
# Inspect existing Access apps/policies so the new app matches the established shape.
set -uo pipefail
set -a; source $HOME/.config/codex/private.env 2>/dev/null; set +a

ACC=5e96dfd2bf22d385e4ffdaa794d74676
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"

echo "=== identity providers ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/identity_providers" \
  | python3 -c '
import sys,json
d=json.load(sys.stdin)
for p in d.get("result",[]):
    print("  id=%s type=%s name=%r" % (p["id"], p["type"], p.get("name")))
'

echo "=== Seedance Lab app (self_hosted reference) ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/79763b22-d4eb-4461-bde4-101c07eed24a" \
  | python3 -c '
import sys,json
d=json.load(sys.stdin)
r=d.get("result") or {}
for k in ["id","name","domain","type","session_duration","allowed_idps","auto_redirect_to_identity","app_launcher_visible","enable_binding_cookie","http_only_cookie_attribute","skip_interstitial","options_preflight_bypass","logo_url"]:
    print("  %-28s %r" % (k, r.get(k)))
'

echo "=== Seedance Lab policies ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps/79763b22-d4eb-4461-bde4-101c07eed24a/policies" \
  | python3 -c '
import sys,json
d=json.load(sys.stdin)
for p in d.get("result",[]):
    print("  name=%r decision=%s" % (p.get("name"), p.get("decision")))
    print("    include:", json.dumps(p.get("include")))
    print("    require:", json.dumps(p.get("require")))
'

echo "=== maibot app (path-scoped reference: domain has /*) ==="
curl -4 -sS -m 30 -H "$AUTH" "https://api.cloudflare.com/client/v4/accounts/$ACC/access/apps" \
  | python3 -c '
import sys,json
d=json.load(sys.stdin)
for a in d.get("result",[]):
    if a.get("name")=="maibot":
        print("  id=%s domain=%r type=%s" % (a["id"], a.get("domain"), a.get("type")))
'
