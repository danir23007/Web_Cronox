#!/usr/bin/env bash
set -euo pipefail
# Same production build/migration/restart sequence, without a destructive reset.
cd /var/www/cronox/Web_Cronox
npm ci
npm run admin:build
cd cronox-backend
npm ci
node scripts/check-user-numbering-release.cjs --deployment-check
node scripts/check-account-state-release.cjs --deployment-check
npx prisma generate
npx prisma migrate deploy
npm run build:compiled
node ../.github/scripts/check-checkout-release-safety.cjs
if [ -f /var/lib/cronox/maintenance.flag ]; then
  # The coordinated root operator starts compatible code with jobs/mail paused.
  # Never restart old or new writers automatically during schema maintenance.
  echo 'MAINTENANCE_RELEASE_INSTALLED_BACKEND_STOPPED'
else
  sudo /usr/bin/pm2 restart cronox
  sudo /usr/bin/pm2 save
  node ../.github/scripts/wait-for-backend.cjs
fi
