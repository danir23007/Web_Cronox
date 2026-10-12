async page => {
  if (page.url() !== 'about:blank') throw Error('Start the reopened disposable browser at about:blank');
  const origin = 'http://127.0.0.1:43126';
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  let refreshes = 0;
  page.on('request', r => { if (r.url().endsWith('/api/auth/refresh')) refreshes++; });
  await page.goto(origin + '/');
  await page.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
  if (await page.evaluate(() => Boolean(window.CRONOX_USER))) throw Error('Logout reactivated after browser reopen');
  if ((await page.context().cookies()).some(c => ['jwt', 'refresh_token'].includes(c.name))) throw Error('Logout cookies returned after reopen');
  if (refreshes) throw Error('Anonymous browser tried to refresh after logout');
  if ((await page.request.get(origin + '/api/me')).status() !== 401) throw Error('Logged out browser remained authorized');
  return { logoutSurvivesRealBrowserReopen: true, anonymousWithoutRefresh: true };
}
