async page => {
  const origin = 'http://127.0.0.1:43126';
  if (page.url() !== 'about:blank' && new URL(page.url()).origin !== origin) throw Error('Disposable loopback server required');
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  let refreshes = 0;
  page.on('request', r => { if (r.url().endsWith('/api/auth/refresh')) refreshes++; });
  await page.goto(origin + '/profile.html');
  await page.waitForFunction(() => Boolean(window.CRONOX_USER?.id));
  const fixture = await (await page.request.get(origin + '/__review/fixture/normal')).json();
  if (!await page.evaluate(email => window.CRONOX_USER.email === email, fixture.email)) throw Error('Reopen recovered a different user');
  const cookies = await page.context().cookies();
  const access = cookies.find(c => c.name === 'jwt');
  const expires = JSON.parse(Buffer.from(access.value.split('.')[1], 'base64url').toString()).exp;
  if (expires <= Date.now() / 1000) throw Error('Reopen did not replace the expired access token');
  if (refreshes !== 1) throw Error('Reopen did not recover through exactly one refresh');
  if (!cookies.find(c => c.name === 'refresh_token')?.httpOnly) throw Error('Persistent refresh cookie missing');
  return { realBrowserClosedAndReopened: true, accountRecoveredWithoutLogin: true, expiredAccessRecovered: true };
}
