async (page) => {
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const context = await page.context().browser().newContext();
  let requests = 0;
  try {
    const target = await context.newPage();
    // Synthetic storefront: no external request, server, account or production metric.
    await target.route('**/*', async route => {
      if (route.request().url().endsWith('/assets/campaign-arrival.js')) {
        const response = await route.fetch({ url: 'http://127.0.0.1:43121/assets/campaign-arrival.js' });
        return route.fulfill({ response });
      }
      if (route.request().url().endsWith('/api/mailbox-access/arrival')) {
        requests++;
        return route.fulfill({ status: requests === 1 ? 503 : 200, json: { attributed: requests > 1 } });
      }
      return route.fulfill({ contentType: 'text/html', body: '<button id="browse">Browse fixture</button>' });
    });
    await target.goto('https://cronox.es/tienda?size=M&cx_campaign=opaque-fixture#details');
    await target.evaluate(() => {
      // Explicitly emulate a regular browser only within this isolated fixture.
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      window.CRONOX_COOKIE_CONSENT = { registerService(service) { window.reviewCampaignConsent = service; } };
      window.CRONOX_API = { getCsrfHeaders: async () => ({}) };
    });
    await target.addScriptTag({ url: 'http://127.0.0.1:43121/assets/campaign-arrival.js' });
    // The loopback asset middleware can issue its existing essential CSRF cookie.
    // Remove that fixture-only transport side effect before testing measurement.
    await context.clearCookies();
    assert(new URL(target.url()).search === '?size=M' && new URL(target.url()).hash === '#details', 'Only tracking parameter removed');
    await target.locator('#browse').click();
    await target.waitForTimeout(2700);
    assert(requests === 0, 'No measurement without consent');
    await target.evaluate(() => window.reviewCampaignConsent.load());
    await target.waitForFunction(() => performance.getEntriesByType('resource').some(e => e.name.includes('/arrival')));
    assert(requests === 1, 'Consented trusted interaction submits once');
    assert(await target.locator('#browse').isVisible(), 'Metric failure leaves storefront working');
    await target.locator('#browse').click();
    await target.waitForTimeout(100);
    assert(requests === 2, 'Later interaction can retry metric failure');
    await target.locator('#browse').click();
    assert(requests === 2, 'Successful submission deduplicated');
    assert((await context.cookies()).length === 0, 'No new cookies');
    await target.evaluate(() => window.reviewCampaignConsent.disable());
    await target.locator('#browse').click();
    assert(requests === 2, 'Revocation stops tracking');
    console.log('PASS: arrival consent, trusted interaction, failure isolation/retry, dedup, destination preservation and zero cookies');
  } finally { await context.close(); }
}
