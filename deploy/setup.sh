#!/usr/bin/env bash
# Ubuntu 22.04/24.04 서버 최초 설정용. 서버에서 한 번만 실행하세요.
# 사용법: bash deploy/setup.sh 내이름.duckdns.org
set -euo pipefail
DOMAIN="${1:?도메인을 인자로 넘겨주세요. 예: bash deploy/setup.sh 내이름.duckdns.org}"

# 1) Node.js (LTS 22) + pm2
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# 2) 앱 설치 및 실행 (이 스크립트는 프로젝트 폴더에서 실행)
npm install --omit=dev
pm2 start ecosystem.config.js
pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u "$USER" --hp "$HOME"

# 3) Caddy (HTTPS 리버스 프록시)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy
sed "s/내이름.duckdns.org/$DOMAIN/" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl restart caddy

echo "완료: https://$DOMAIN"
