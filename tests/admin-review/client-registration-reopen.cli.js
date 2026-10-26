async page => {
  if (page.url() !== 'about:blank') throw Error('Reopen the same persistent profile at about:blank');
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  await page.goto('http://127.0.0.1:43126/profile.html');
  await page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
  if (!await page.evaluate(() => String(window.CRONOX_USER.id) === localStorage.getItem('review.expected-user'))) throw Error('Registration identity was lost');
  const same = await page.request.get('http://127.0.0.1:43126/api/me');
  if (!same.ok() || same.headers()['cache-control'] !== 'no-store') throw Error('Server identity not confirmed');
  const cookie = (await page.context().cookies()).find(c => c.name === 'refresh_token');
  const environment = await page.evaluate(() => ({ mobileUA: /Mobile|Android/.test(navigator.userAgent), touch: navigator.maxTouchPoints > 0 }));
  return { automaticRegistrationSurvivesBrowserRestart: true, serverConfirmed: true, browserCookieDays: Math.round((cookie.expires - Date.now() / 1000) / 86400), ...environment };
}
