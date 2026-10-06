#!/usr/bin/env bash
# Install the uploaded release into /opt/mopai/app and start the services.
set -euo pipefail

echo "== extract release =="
cd /tmp
rm -rf /tmp/mopai-extract
mkdir -p /tmp/mopai-extract
tar -xzf /tmp/mopai-release.tar.gz -C /tmp/mopai-extract
ls -la /tmp/mopai-extract/dist

echo "== install into /opt/mopai/app =="
sudo rm -rf /opt/mopai/app/dist
sudo cp -r /tmp/mopai-extract/dist /opt/mopai/app/dist
sudo mkdir -p /opt/mopai/app/data
sudo chown -R mopai:mopai /opt/mopai/app
sudo chmod 750 /opt/mopai/app/data
echo "app dir:"
sudo ls -la /opt/mopai/app
echo "dist:"
sudo ls -la /opt/mopai/app/dist

echo "== enable and start app =="
sudo systemctl enable --now mopai.service
sleep 5
sudo systemctl is-active mopai.service || true
echo "--- status ---"
sudo systemctl status mopai.service --no-pager -l | head -25 || true
echo "--- recent logs ---"
sudo journalctl -u mopai.service -n 40 --no-pager || true

echo "== local health check =="
curl -4 -sS -m 10 -o /dev/null -w "GET / -> %{http_code}\n" http://127.0.0.1:3100/ || true
curl -4 -sS -m 10 -H "Accept: text/html" -o /dev/null -w "GET /login -> %{http_code}\n" http://127.0.0.1:3100/login || true
curl -4 -sS -m 10 -o /dev/null -w "GET /api/trpc/auth.me -> %{http_code}\n" http://127.0.0.1:3100/api/trpc/auth.me || true

echo "== clean staging =="
rm -rf /tmp/mopai-extract /tmp/mopai-release.tar.gz /tmp/bootstrap.sh
echo done
