#!/usr/bin/env bash
set -euo pipefail
test "$(id -un)" = deploy
test -f /var/lib/cronox/maintenance.flag
# Build tools are needed even when the application runs with NODE_ENV=production.
export npm_config_include=dev
export CRONOX_COORDINATED_BUILD=1
exec /usr/bin/bash /var/www/cronox/Web_Cronox/.github/scripts/deploy-vps-release.sh
