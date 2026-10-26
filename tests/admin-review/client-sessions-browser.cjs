async page => {
  const origin = 'http://127.0.0.1:43126';
  if (new URL(page.url()).origin !== origin) throw Error('Disposable loopback server required');
  const check = (value, message) => { if (!value) throw Error(message); };
  const results = [];
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; localStorage.removeItem('cronox_open_auth_on_load'); });
  const state = () => page.request.get(origin + '/__review/session-state').then(r => r.json());
  const helper = (name, data = {}) => page.request.post(origin + '/__review/' + name, { data });
  const user = () => page.waitForFunction(() => Boolean(window.CRONOX_USER?.id));
  const fixture = await (await page.request.get(origin + '/__review/fixture/normal')).json();
  const uiLogin = async () => {
    await page.goto(origin + '/');
    await page.waitForFunction(() => Boolean(window.CRONOX_openAuthModal));
    await page.evaluate(() => window.CRONOX_openAuthModal('login'));
    await page.locator('#authLoginEmail').fill(fixture.email);
    await page.locator('#authLoginPassword').fill(fixture.initial);
    const response = page.waitForResponse(r => r.url().endsWith('/api/auth/login'));
    await page.locator('#authLoginForm button[type=submit]').click();
    check((await response).ok(), 'Real UI login failed');
    await user();
  };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/');
  const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
  if (await reject.isVisible()) await reject.click();
  await page.evaluate(() => window.CRONOX_openAuthModal('register'));
  await page.locator('#authRegisterFirstName').fill('Disposable');
  await page.locator('#authRegisterLastName').fill('Session');
  await page.locator('#authRegisterEmail').fill('session-' + crypto.randomUUID() + '@session.test');
  await page.locator('#authRegisterPassword').fill('Local-' + crypto.randomUUID());
  const registration = page.waitForResponse(r => r.url().endsWith('/api/auth/register'));
  await page.locator('#authRegisterForm button[type=submit]').click();
  const registrationResponse = await registration;
  check(registrationResponse.ok(), 'Real registration failed');
  const setCookies = (await registrationResponse.headersArray()).filter(h => h.name.toLowerCase() === 'set-cookie').map(h=>h.value);
  check(['jwt','refresh_token'].every(name=>setCookies.some(value=>value.startsWith(name+'=') && /; SameSite=Lax/i.test(value) && /; HttpOnly/i.test(value))), 'Server cookie flags missing');
  await user();
  const registeredId = await page.evaluate(() => window.CRONOX_USER.id);
  await page.reload(); await user();
  check(await page.evaluate(id => window.CRONOX_USER.id === id, registeredId), 'Registration lost across reload');
  const cookies = await page.context().cookies();
  for (const name of ['jwt', 'refresh_token']) {
    const cookie = cookies.find(c => c.name === name);
    check(cookie?.httpOnly && cookie.path === '/' && cookie.expires > Date.now() / 1000, 'Persistent technical cookie missing');
  }
  check(Math.abs((await state()).deadline - (Date.now() + 500 * 86400_000)) < 5000, 'Server deadline is not 500 days');
  const browserCookieDays = Math.round((cookies.find(c => c.name === 'refresh_token').expires * 1000 - Date.now()) / 86400_000);
  results.push({ registration: true, reload: true, consentRejected: true, serverDays: 500, browserCookieDays, serverSameSite: "Lax", browserReportedSameSite: cookies.find(c=>c.name === "refresh_token").sameSite });
  await helper('session-age', { days: 400 });
  const before = await state();
  check((await page.request.get(origin + '/api/me')).ok(), 'Aged access session rejected');
  const csrf = (await (await page.request.get(origin + '/api/auth/csrf')).json()).csrfToken;
  check((await page.request.post(origin + '/api/auth/refresh', { headers: { Origin: origin, 'X-CSRF-Token': csrf } })).ok(), 'Passive refresh failed');
  check((await state()).issued === before.issued, 'Passive refresh renewed inactivity');
  check((await page.request.post(origin + '/api/auth/visit', { headers: { Origin: origin, 'X-CSRF-Token': csrf, 'X-Cronox-Client-Visit': 'visible' } })).ok(), 'Internal visit request failed');
  check((await state()).issued === before.issued, 'Internal request renewed session');
  const visited = page.waitForResponse(r => r.url().endsWith('/api/auth/visit') && r.ok());
  await page.reload(); await user(); await visited;
  check(Math.abs((await state()).deadline - (Date.now() + 500 * 86400_000)) < 5000, 'Visible visit did not persist 500-day renewal');
  results.push({ passiveRefreshNoRenewal: true, internalNoRenewal: true, visibleVisitPersisted: true });

  await helper('access-expired');
  let refreshes = 0;
  const listener = r => { if (r.url().endsWith('/api/auth/refresh')) refreshes++; };
  page.on('request', listener);
  const statuses = await page.evaluate(async () => Promise.all([1, 2, 3].map(n => fetch('/api/me?race=' + n, { credentials: 'include' }).then(r => r.status))));
  page.off('request', listener);
  check(statuses.every(s => s === 200) && refreshes === 1, 'Concurrent expired-access recovery failed');
  await helper('session-age', { days: 1 });
  const rawRaces = await Promise.all(Array.from({ length: 4 }, () => page.request.post(origin + '/api/auth/refresh', {
    headers: { Origin: origin, 'X-CSRF-Token': csrf },
  })));
  check(rawRaces.every(r => r.ok()), 'Actual parallel backend rotations failed');
  const replacements = rawRaces.map(r => r.headers()['set-cookie'].match(/refresh_token=([^;]+)/)?.[1]);
  check(new Set(replacements).size === 1 && replacements[0], 'Parallel backend returned competing refresh descendants');
  results.push({ expiredAccessRecovered: true, concurrentRequests: true, refreshes });

  const preservedId = (await state()).id;
  const cookieBefore = (await page.context().cookies()).find(c => c.name === 'refresh_token').value;
  await helper('session-failure');
  check((await page.request.get(origin + '/api/me')).status() === 500, 'Real database outage was not simulated');
  check((await page.context().cookies()).find(c => c.name === 'refresh_token')?.value === cookieBefore, 'Database outage cleared cookies');
  await page.route('**/api/me*', r => r.abort('failed'));
  check(await page.evaluate(async () => { try { await fetch('/api/me', { credentials: 'include' }); return false; } catch { return Boolean(window.CRONOX_USER?.id); } }), 'Network outage erased identity');
  await page.unroute('**/api/me*');
  await page.reload(); await user();
  check((await state()).id === preservedId, 'Temporary outage created/replaced session');
  results.push({ realDatabaseOutage: true, networkOutage: true, sessionPreserved: true });

  const browser = page.context().browser();
  const other = await browser.newContext();
  try {
    const token = (await (await other.request.get(origin + '/api/auth/csrf')).json()).csrfToken;
    check((await other.request.post(origin + '/api/auth/login', { headers: { Origin: origin, 'X-CSRF-Token': token }, data: { email: fixture.email, password: fixture.initial } })).ok(), 'Other browser login failed');
    const otherState = await (await other.request.get(origin + '/__review/session-state')).json();
    check(otherState.id !== preservedId, 'Device sessions were shared');
    // An unsuccessful explicit logout must leave the current valid session intact.
    await helper('session-failure');
    const failed = await page.evaluate(async () => { try { await window.CRONOX_API.logout(); return false; } catch { return Boolean(window.CRONOX_USER?.id); } });
    check(failed && (await state()).id === preservedId, 'Failed logout erased valid identity');
    await page.goto(origin + '/profile.html'); await user();
    const response = page.waitForResponse(r => r.url().endsWith('/api/auth/logout'));
    await page.locator('[data-profile-tab=logout]').click();
    check((await response).ok(), 'UI logout failed');
    await page.waitForURL(url => !url.pathname.includes('profile'));
    await page.reload();
    await page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
    check(!(await page.context().cookies()).some(c => ['jwt', 'refresh_token'].includes(c.name)), 'Logout restored technical cookies');
    check((await other.request.get(origin + '/api/me')).ok(), 'Logout revoked another browser');
    results.push({ logoutPersisted: true, failedLogoutPreserved: true, independentBrowsers: true });
  } finally { await other.close(); }

  await uiLogin();
  // Fresh optional-consent prompt: accepting it must not change the auth family.
  await page.evaluate(() => { localStorage.removeItem('cronox.cookieConsent'); document.cookie = 'cronox_cookie_consent=; Max-Age=0; path=/'; });
  const authId = (await state()).id;
  // The preference is reset through the browser API using the actual consent key below.
  await page.context().clearCookies({ name: /consent/i });
  await page.reload(); await user();
  const accept = page.getByRole('button', { name: 'ACEPTAR', exact: true });
  check(await accept.isVisible(), 'Consent accept prompt missing');
  await accept.click();
  await page.reload(); await user();
  check((await state()).id === authId, 'Consent acceptance changed session');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/profile.html'); await user();
  await page.screenshot({ path: 'output/playwright/client-session-mobile.png', fullPage: true });
  results.push({ consentAccepted: true, mobileAccountRecovered: true });

  await helper('session-role', { role: 'FRIEND' });
  await helper('session-age', { days: 400 });
  await page.reload(); await user();
  check(await page.evaluate(() => window.CRONOX_USER.role === 'FRIEND'), 'FRIEND account did not recover');
  check(Math.abs((await state()).deadline - (Date.now() + 500 * 86400_000)) < 5000, 'FRIEND did not renew 500 days');
  await helper('session-role', { role: 'USER' });
  results.push({ realFriendSessionRenewed: true });

  await helper('session-age', { days: 501 });
  const expired = await page.request.get(origin + '/api/me');
  check(expired.status() === 401, '501-day inactive session remained valid');
  const expiredCsrf = (await (await page.request.get(origin + '/api/auth/csrf')).json()).csrfToken;
  check((await page.request.post(origin + '/api/auth/refresh', { headers: { Origin: origin, 'X-CSRF-Token': expiredCsrf } })).status() === 401, 'Expired session reactivated');
  await page.goto(origin + '/');
  await uiLogin();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + '/profile.html'); await user();
  await page.screenshot({ path: 'output/playwright/client-session-desktop.png', fullPage: true });
  await helper('access-expired');
  results.push({ inactivityExpired: true, preparedPersistentReopen: true });
  return results;
}
