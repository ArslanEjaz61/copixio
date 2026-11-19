#!/usr/bin/env bash
# Deploy on the copixio server: pull the pushed code, install, build, restart. Never restarts on a failed build.
#   cd /var/www/copixio && ./deploy.sh
set -euo pipefail
cd /var/www/copixio
git fetch --quiet origin main
git reset --hard origin/main
npm ci --no-audit --no-fund
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save >/dev/null
echo "DEPLOYED $(git rev-parse --short HEAD)"
