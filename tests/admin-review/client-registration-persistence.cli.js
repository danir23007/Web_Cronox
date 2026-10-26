async page => {
  const origin = 'http://127.0.0.1:43126';
  if (page.url() !== 'about:blank' && new URL(page.url()).origin !== origin) throw Error('Disposable server required');
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  await page.goto(origin);
  await page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
  const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
  if (await reject.isVisible()) await reject.click();
  const observer = await page.context().newPage();
  await observer.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  await observer.goto(origin);
  await observer.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
  await page.bringToFront();
  await page.evaluate(() => window.CRONOX_openAuthModal('register'));
  await page.locator('#authRegisterFirstName').fill('Cuenta');
  await page.locator('#authRegisterLastName').fill('Persistente');
  await page.locator('#authRegisterEmail').fill('persistent-' + crypto.randomUUID() + '@session.test');
  await page.locator('#authRegisterPassword').fill('Local-' + crypto.randomUUID());
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/register'));
  await page.locator('#authRegisterForm button[type=submit]').click();
  const registered = await response;
  if (!registered.ok()) throw Error('Normal registration failed');
  await page.waitForFunction(() => window.CRONOX_USER?.id);
  const userId = await page.evaluate(() => window.CRONOX_USER.id);
  await observer.waitForFunction(id => window.CRONOX_USER?.id === id, userId);
  await observer.close();
  // Only the non-sensitive expected fixture ID is retained for the assertion.
  await page.evaluate(id => localStorage.setItem('review.expected-user', String(id)), userId);
  const headers = (await registered.headersArray()).filter(h => h.name.toLowerCase() === 'set-cookie');
  const attributes = headers.filter(h => /^(jwt|refresh_token)=/.test(h.value)).map(h => ({
    name: h.value.split('=')[0], attributes: h.value.split(';').slice(1).map(v => v.trim()),
  }));
  const cookies = (await page.context().cookies()).filter(c => ['jwt', 'refresh_token'].includes(c.name));
  if (!cookies.every(c => c.httpOnly && c.path === '/' && c.sameSite === 'Lax' && c.expires > Date.now() / 1000)) throw Error('Non-persistent auth cookie');
  await page.goto('about:blank');
  return { registeredWithAutomaticLogin: true, otherTabRecoveredFromServer: true, readyForFullBrowserRestart: true, cookies: attributes };
}
