#!/usr/bin/env bash
set -euo pipefail

: "${SSH_HOST:?Missing CRONOX_VPS_HOST}"
: "${SSH_PORT:?Missing CRONOX_VPS_PORT}"
: "${SSH_USER:?Missing CRONOX_VPS_USER}"
: "${SSH_KEY:?Missing CRONOX_VPS_SSH_KEY}"
: "${GITHUB_SHA:?Missing release commit}"
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 1
[[ "$SSH_USER" == deploy ]] || { echo 'Unexpected deployment user'; exit 1; }

key="$RUNNER_TEMP/cronox-deploy-key"
trap 'rm -f "$key"' EXIT
umask 077
printf '%s\n' "$SSH_KEY" > "$key"
ssh_options=(-i "$key" -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$GITHUB_WORKSPACE/.github/ssh/known_hosts"
  -o ConnectTimeout=20 -o ConnectionAttempts=2
  -o ServerAliveInterval=15 -o ServerAliveCountMax=3)

# Bounded connection attempts apply only before connection establishment.
# Never retry deploy.sh after an ambiguous disconnect during deployment.
echo 'Checking SSH identity, authentication and script access (read only)...'
ssh "${ssh_options[@]}" "$SSH_USER@$SSH_HOST" \
  'test "$(id -un)" = deploy && test -x /var/www/cronox/deploy.sh && echo SSH_PRECHECK_OK'

echo 'Checking main and invoking the existing deployment script once...'
ssh "${ssh_options[@]}" "$SSH_USER@$SSH_HOST" "bash -s -- $GITHUB_SHA" <<'REMOTE'
set -euo pipefail
expected="$1"
cd /var/www/cronox/Web_Cronox
latest="$(git ls-remote origin refs/heads/main | cut -f1)"
if [ "$latest" != "$expected" ]; then
  echo 'Refusing stale workflow: this commit is no longer main.'
  exit 1
fi
git fetch origin main
# Install the exact incoming preflight dependencies outside the running application.
# The database readiness guard still runs BEFORE merging HTML or touching app dependencies.
git show "$expected:.github/scripts/run-release-preflight.cjs" | node -e '
const Module=require("node:module"),fs=require("node:fs");
const filename=process.cwd()+"/.github/scripts/run-release-preflight.cjs";
const runner=new Module(filename,module);runner.filename=filename;
runner.paths=Module._nodeModulePaths(process.cwd());
runner._compile(fs.readFileSync(0,"utf8"),filename);
try { process.exitCode=runner.exports.main(process.argv.slice(1)); }
catch(error) { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/gi,"[redacted connection]"));process.exitCode=1; }
' -- --repo="$PWD" --revision="$expected" --env-file="$PWD/cronox-backend/.env"
# Keep unrelated working files intact; conflicts abort rather than discard them.
git merge --ff-only origin/main
bash .github/scripts/deploy-vps-release.sh
actual="$(git rev-parse HEAD)"
if [ "$actual" != "$expected" ]; then
  echo 'Deployment revision differs from the verified workflow commit.'
  exit 1
fi
status="$(curl --silent --show-error --output /tmp/cronox-export-smoke.json --write-out '%{http_code}' 'http://127.0.0.1:3000/api/admin/exports/users?scope=all')"
if [ "$status" != 401 ] && [ "$status" != 429 ]; then
  echo "Admin export route smoke failed with HTTP $status"
  exit 1
fi
printf 'DEPLOYED_COMMIT=%s\n' "$actual"
REMOTE
