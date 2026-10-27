#!/usr/bin/env bash
set -euo pipefail
# Build only; installed controller owns maintenance, backup, migrations and PM2.
test "$(id -un)" = deploy
test "${CRONOX_COORDINATED_BUILD:-}" = 1
test -f /var/lib/cronox/maintenance.flag
cd /var/www/cronox/Web_Cronox
npm ci
npm run admin:build
cd cronox-backend
npm ci
node scripts/check-user-numbering-release.cjs --deployment-check --before-migrate
node scripts/check-account-state-release.cjs --deployment-check
npx prisma generate
npm run build:compiled
node ../.github/scripts/check-checkout-release-safety.cjs
echo 'COORDINATED_BUILD_COMPLETE_WRITERS_STOPPED'
