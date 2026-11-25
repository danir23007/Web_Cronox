'use strict';
// Creates a private Playwright storage state using only the guarded local admin.
const fs = require('node:fs');
const path = require('node:path');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');
(async () => {
  const env = loadLocalEnvironment();
  const origin = new URL(env.FRONTEND_URL).origin;
  const csrf = await fetch(`${origin}/api/auth/csrf`);
  const { csrfToken } = await csrf.json();
  const cookieHeaders = csrf.headers.getSetCookie();
  const login = await fetch(`${origin}/api/auth/login`, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-csrf-token': csrfToken, Cookie: cookieHeaders.map(value => value.split(';')[0]).join('; ') },
    body: JSON.stringify({ email: 'admin@cronox.local', password: env.LOCAL_ADMIN_PASSWORD }),
  });
  if (!login.ok) throw new Error(`Local login failed: ${login.status}`);
  const cookies = [...cookieHeaders, ...login.headers.getSetCookie()].map(header => {
    const [pair, ...attributes] = header.split(';'), separator = pair.indexOf('=');
    const attr = attributes.map(value => value.trim());
    return { name: pair.slice(0, separator), value: pair.slice(separator + 1), domain: 'localhost', path: '/', expires: -1, httpOnly: attr.includes('HttpOnly'), secure: false, sameSite: 'Lax' };
  });
  const directory = path.resolve(__dirname, '../../output/black-friday');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'login.private.json'), JSON.stringify({ cookies, origins: [] }));
  console.log('Local login ready (private state; no credentials printed).');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
