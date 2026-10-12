#!/usr/bin/env bash
set -euo pipefail
# Same production build/migration/restart sequence, without a destructive reset.
cd /var/www/cronox/Web_Cronox
npm ci
npm run admin:build
cd cronox-backend
npm ci
node scripts/check-user-numbering-release.cjs --deployment-check
npx prisma generate
npx prisma migrate deploy
npm run build:compiled
sudo /usr/bin/pm2 restart cronox
sudo /usr/bin/pm2 save
node ../.github/scripts/wait-for-backend.cjs
