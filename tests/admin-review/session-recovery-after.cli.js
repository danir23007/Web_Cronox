async page => {
  const origin = 'http://127.0.0.1:43126';
  if (new URL(page.url()).origin !== origin) throw Error('Disposable loopback server required');
  const check = (ok, message) => { if (!ok) throw Error(message); };
  const context = page.context();
  const state = () => page.request.get(origin + '/__review/session-state').then(r => r.json());
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  const initialSession = (await state()).id;
  const recovered = () => page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated' && window.CRONOX_USER?.id);
  const results = [];
  for (const path of ['/', '/faqs.html', '/profile.html', '/favorites.html']) {
    await page.goto(origin + path); await recovered();
    check((await state()).id === initialSession, 'Navigation changed the session');
  }
  await page.goto('about:blank');
  const tabs = await Promise.all([context.newPage(), context.newPage()]);
  for (const tab of tabs) {
    await tab.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
    await tab.goto(origin + '/profile.html');
    await tab.waitForFunction(() => window.CRONOX_USER?.id);
  }
  await page.request.post(origin + '/__review/access-expired');
  const simultaneous = await Promise.all(tabs.map(tab => tab.evaluate(async () => Promise.all([1, 2].map(i => fetch('/api/me?parallel=' + i).then(r => r.status))))));
  check(simultaneous.flat().every(status => status === 200), 'Multi-tab refresh failed');
  for (const tab of tabs) await tab.close();
  check(context.pages().every(tab => !tab.url().startsWith(origin)), 'Storefront tab left open');
  await page.goto(origin + '/'); await recovered();
  check((await state()).id === initialSession, 'Closing all storefront tabs lost session');
  results.push({ navigation: true, closedAllStorefrontTabs: true, simultaneousTabs: true });

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.route('**/api/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"Temporary test outage"}' }));
    await page.goto(origin + '/profile.html');
    await page.waitForFunction(() => Boolean(window.CRONOX_AUTH_READY));
    await page.evaluate(() => window.CRONOX_AUTH_READY);
    check(await page.locator('#profileBtn').getAttribute('data-auth-state') === 'unknown', 'Failed recovery displayed a guest');
    await page.locator('#profileBtn').click();
    await page.locator('#authRecoveryStatus').waitFor();
    check(!await page.locator('#authOverlay.is-open').isVisible(), 'Unavailable identity opened login');
    check((await page.request.get(origin + '/api/me')).ok(), 'Server session was actually invalid');
    await page.unroute('**/api/me');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await recovered();
    check((await state()).id === initialSession, 'Recovery replaced valid session');
    await page.waitForFunction(() => document.querySelector('#profileBtn')?.dataset.authState === 'logged');
    await page.waitForFunction(() => document.getElementById('firstName')?.value === window.CRONOX_USER.firstName && document.getElementById('profileMessage')?.hidden);
    await page.screenshot({ path: `output/playwright/session-persistence/recovered-${width}.png`, fullPage: true });
    await context.setOffline(true);
    check(await page.evaluate(async () => { await window.CRONOX_refreshAuthState(); return window.CRONOX_AUTH_STATE === 'authenticated' && Boolean(window.CRONOX_USER?.id); }), 'Offline reset known identity');
    await context.setOffline(false);
    await recovered();
    results.push({ width, initial503RecoveredWithoutReload: true, offlineKeptIdentity: true });
  }
  await page.route('**/api/me', route => route.abort('failed'));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.CRONOX_AUTH_READY));
  await page.evaluate(() => window.CRONOX_AUTH_READY);
  check(await page.evaluate(() => window.CRONOX_AUTH_STATE === 'unknown'), 'Network failure proved anonymity');
  await page.unroute('**/api/me');
  await recovered(); // automatic visible-page retry, no reload or synthetic online event
  results.push({ initialNetworkFailureAutomaticallyRecovered: true });

  const beforeProcess = await (await page.request.get(origin + '/__review/process')).json();
  await page.goto('about:blank');
  await page.request.post(origin + '/__review/restart', { headers: { Connection: 'close' } });
  let afterProcess;
  for (let n = 0; n < 100; n++) {
    try { afterProcess = await (await page.request.get(origin + '/__review/process', { timeout: 1000, headers: { Connection: 'close' } })).json(); } catch {}
    if (afterProcess?.pid !== beforeProcess.pid && afterProcess?.pid) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  check(afterProcess?.pid && afterProcess.pid !== beforeProcess.pid, 'Backend process did not restart');
  await page.goto(origin + '/profile.html'); await recovered();
  check((await state()).id === initialSession, 'Backend restart lost DB session');
  results.push({ newBackendProcess: true, sameDatabaseSessionRecovered: true });

  // Preserve credentials in process memory only, to verify real revocation.
  const oldCookies = (await context.cookies()).map(c => `${c.name}=${c.value}`).join('; ');
  const csrf = (await (await page.request.get(origin + '/api/auth/csrf')).json()).csrfToken;
  const logout = page.waitForResponse(r => r.url().endsWith('/api/auth/logout'));
  await page.locator('[data-profile-tab=logout]').click();
  check((await logout).ok(), 'Explicit UI logout failed');
  await page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
  const replayAccess = await page.request.get(origin + '/api/me', { headers: { Cookie: oldCookies } });
  const replayRefresh = await page.request.post(origin + '/api/auth/refresh', { headers: { Cookie: oldCookies, Origin: origin, 'X-CSRF-Token': csrf } });
  check(replayAccess.status() === 401 && replayRefresh.status() === 401, 'Logged-out credentials were still accepted');
  check((await (await page.request.get(origin + '/__review/session-state', { headers: { Cookie: oldCookies } })).json()).revoked, 'Logout was not persisted');
  results.push({ explicitLogout: true, oldAccessAndRefreshRevoked: true, readyForLogoutBrowserRestart: true });
  return results;
}
