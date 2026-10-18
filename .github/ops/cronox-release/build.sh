#!/usr/bin/env bash
set -euo pipefail
test "$(id -un)" = deploy
test -f /var/lib/cronox/maintenance.flag
export CRONOX_COORDINATED_BUILD=1
exec /usr/bin/bash /var/www/cronox/Web_Cronox/.github/scripts/deploy-vps-release.sh
