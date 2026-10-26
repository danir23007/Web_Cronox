async page => {
  const origin = 'http://127.0.0.1:43126';
  const fixture = await (await page.request.get(origin + '/__review/fixture/normal')).json();
  const context = await page.context().browser().newContext();
  const check = (ok, message) => { if (!ok) throw Error(message); };
  let closing = false;
  let forwardingFailed = false;
  // Exercise actual browser origins/cookies against the isolated server only.
  // No request, credential or fixture may reach the public site or third parties.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['cronox.es', 'www.cronox.es'].includes(url.hostname)) return route.abort();
    const headers = { ...request.headers(), host: url.hostname, cookie: request.headers().cookie || '' };
    try {
      const response = await route.fetch({ url: origin + url.pathname + url.search, headers, maxRedirects: 0 });
      await route.fulfill({ response });
    } catch {
      // Playwright errors include request headers. Never print test credentials,
      // including cancellation of requests when closing the test context.
      if (!closing) forwardingFailed = true;
      await route.abort().catch(() => undefined);
    }
  });
  const tab = await context.newPage();
  const login = async () => {
    await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'anonymous');
    const reject = tab.getByRole('button', { name: 'RECHAZAR', exact: true });
    if (await reject.isVisible()) await reject.click();
    await tab.evaluate(() => window.CRONOX_openAuthModal('login'));
    await tab.locator('#authLoginEmail').fill(fixture.email);
    await tab.locator('#authLoginPassword').fill(fixture.initial);
    await tab.locator('#authLoginForm button[type=submit]').click();
    await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
  };
  try {
    await tab.goto('https://www.cronox.es/cuenta');
    check(new URL(tab.url()).hostname === 'cronox.es', 'New account visit was split across domains');
    await login();
    for (const route of ['/cuenta', '/checkout', '/favoritos', '/']) {
      await tab.goto('https://www.cronox.es' + route);
      check(new URL(tab.url()).hostname === 'cronox.es', 'New visit did not use canonical origin');
      await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
    }
    const customerCookies = (await context.cookies('https://cronox.es/')).filter(c => ['jwt', 'refresh_token'].includes(c.name));
    check(customerCookies.length === 2 && customerCookies.every(c => c.domain === 'cronox.es'), 'Auth cookie domain was broadened');
    // Model a historical www browser with a host-only cart; no real cart exists.
    await context.addCookies([{ name: 'cartId', value: crypto.randomUUID(), domain: 'www.cronox.es', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }]);
    await tab.goto('https://www.cronox.es/cuenta');
    check(new URL(tab.url()).hostname === 'www.cronox.es', 'Historical checkout origin was discarded');
    await login();
    for (const route of ['/', '/cuenta', '/checkout']) {
      await tab.goto('https://www.cronox.es' + route);
      check(new URL(tab.url()).hostname === 'www.cronox.es', 'Legacy session moved across host-only cookies');
      await tab.waitForFunction(() => window.CRONOX_AUTH_STATE === 'authenticated');
    }
    check(!forwardingFailed, 'A local forwarded request failed (headers omitted)');
    return { allNetworkRoutedToDisposableServer: true, canonicalCustomerEntry: true, apexSessionRecoveredAfterWwwEntry: true, hostOnlyCookiesPreserved: true, legacyWwwSessionAndCartPreserved: true };
  } finally { closing = true; await context.close(); }
}
