#!/usr/bin/env bash
set -euo pipefail
: "${SSH_HOST:?Missing CRONOX_VPS_HOST}"
: "${SSH_PORT:?Missing CRONOX_VPS_PORT}"
: "${SSH_USER:?Missing CRONOX_VPS_USER}"
: "${SSH_KEY:?Missing CRONOX_VPS_SSH_KEY}"
: "${GITHUB_SHA:?Missing release commit}"
[[ "$GITHUB_SHA" =~ ^[0-9a-f]{40}$ && "$SSH_USER" == deploy ]] || exit 1
key="$RUNNER_TEMP/cronox-deploy-key"
status_file="$RUNNER_TEMP/cronox-release-status.json"
trap 'rm -f "$key" "$status_file"' EXIT
umask 077
printf '%s\n' "$SSH_KEY" > "$key"
ssh_options=(-i "$key" -p "$SSH_PORT" -o BatchMode=yes -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o "UserKnownHostsFile=$GITHUB_WORKSPACE/.github/ssh/known_hosts"
  -o ConnectTimeout=15 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)

# Request once; systemd owns execution even if SSH/Actions disconnects.
# Reconcile the SAME SHA, never replay migrations after an ambiguous response.
ssh "${ssh_options[@]}" "$SSH_USER@$SSH_HOST" \
  'test "$(id -un)" = deploy && test -x /usr/local/sbin/cronox-release' || {
    echo 'Installed release controller unavailable; no legacy fallback.'; exit 1;
  }
ssh "${ssh_options[@]}" "$SSH_USER@$SSH_HOST" \
  "sudo -n /usr/local/sbin/cronox-release request $GITHUB_SHA" || \
  echo 'Request response unavailable; reconciling journal without retrying request.'

for attempt in $(seq 1 300); do
  if ssh "${ssh_options[@]}" "$SSH_USER@$SSH_HOST" \
      "sudo -n /usr/local/sbin/cronox-release status $GITHUB_SHA" > "$status_file"; then
    state="$(python3 - "$status_file" "$GITHUB_SHA" <<'PY'
import json,sys
s=json.load(open(sys.argv[1]))
assert s['revision']==sys.argv[2]
assert s['status'] in ('queued','running','success','held','interrupted','failed_before_maintenance','recovered','recovery_queued','recovering')
print(s['status'])
PY
)"
    printf 'RELEASE=%s STATE=%s\n' "$GITHUB_SHA" "$state"
    case "$state" in
      success) echo "DEPLOYED_COMMIT=$GITHUB_SHA"; exit 0 ;;
      held|interrupted|failed_before_maintenance|recovered)
        echo 'Release unsuccessful. Consult recorded phase; no automatic code/database rollback.'; exit 1 ;;
    esac
  fi
  sleep 10
done
echo 'Result unknown: inspect this SHA on server. Do not start a second release.'
exit 1
