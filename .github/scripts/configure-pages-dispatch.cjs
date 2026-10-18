'use strict';
// Administrative repository configuration, NOT invoked by CI or deployment.
// --plan is GET-only; --apply requires separate owner approval.
const cp = require('node:child_process');
async function main() {
  const mode = process.argv[2];
  if (!['--plan', '--apply'].includes(mode) || process.argv.length !== 3) throw Error('MODE_REQUIRED');
  let token = process.env.GH_TOKEN;
  if (!token) {
    const result = cp.spawnSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\npath=danir23007/Web_Cronox.git\n\n',
      encoding: 'utf8', windowsHide: true, timeout: 15000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
    });
    if (result.status !== 0) throw Error('PRIVATE_AUTH_UNAVAILABLE');
    token = result.stdout.split('\n').find(line => line.startsWith('password='))?.slice(9);
  }
  if (!token) throw Error('PRIVATE_AUTH_UNAVAILABLE');
  const url = 'https://api.github.com/repos/danir23007/Web_Cronox/pages';
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28' };
  const response = await fetch(url, { headers });
  if (!response.ok) throw Error('PAGES_CONFIGURATION_UNAVAILABLE');
  const current = await response.json();
  if (current.build_type === 'workflow') { console.log('PAGES_ALREADY_WORKFLOW'); return; }
  if (current.build_type !== 'legacy' || current.source?.branch !== 'main' || current.source?.path !== '/')
    throw Error('PAGES_CONFIGURATION_CHANGED_REVIEW_REQUIRED');
  console.log(JSON.stringify({ current: 'legacy main /', proposed: 'workflow', mode }));
  if (mode === '--plan') return;
  const changed = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ build_type: 'workflow' }) });
  if (!changed.ok) throw Error('PAGES_UPDATE_FAILED');
  const verification = await fetch(url, { headers });
  if (!verification.ok || (await verification.json()).build_type !== 'workflow') throw Error('PAGES_UPDATE_NOT_VERIFIED');
  console.log('PAGES_WORKFLOW_MODE_VERIFIED');
}
main().catch(() => { console.error('PAGES_CONFIGURATION_NOT_COMPLETED: private details withheld'); process.exitCode = 1; });
