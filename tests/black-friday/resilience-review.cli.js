async (page) => {
  const origin = 'http://localhost:3000';
  if (new URL(page.url()).origin !== origin) throw new Error('Local review only');
  const context = await page.context().browser().newContext({ viewport: { width: 1440, height: 900 } });
  const visitor = await context.newPage();
  await visitor.route(`${origin}/api/black-friday`, route => route.fulfill({ json: { enabled: false, serverTime: new Date().toISOString() } }));
  const metrics = async () => {
    await visitor.evaluate(() => document.fonts.ready);
    await visitor.evaluate(() => window.CRONOX_MEDIA_FRAMING.load());
    return visitor.evaluate(() => {
      const rect = selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return [box.x, box.y, box.width, box.height];
      };
      const image = document.querySelector('#hero [data-media-placement]');
      return { topbar: rect('.topbar'), hero: rect('#hero'), storeTop: rect('#store')[1], objectPosition: getComputedStyle(image).objectPosition, transform: getComputedStyle(image).transform, image: image.getAttribute('src') };
    });
  };
  try {
    // Compare the disabled version against the same page with the campaign script omitted.
    const asset = '**/assets/black-friday.js?*';
    await visitor.route(asset, route => route.fulfill({ contentType: 'application/javascript', body: '' }));
    await visitor.goto(`${origin}/`);
    const baseline = await metrics();
    await visitor.unroute(asset);
    await visitor.goto(`${origin}/`);
    const disabled = await metrics();
    if (JSON.stringify(baseline) !== JSON.stringify(disabled)) throw new Error('Disabled campaign changes original geometry or media');
    if (await visitor.locator('.bf-hero,.bf-banner').count()) throw new Error('Disabled campaign rendered');
    await visitor.screenshot({ path: 'output/black-friday/disabled-baseline.png' });
    const unauthorized = await context.request.get(`${origin}/api/admin/black-friday`);
    if (unauthorized.status() !== 401) throw new Error('Admin settings available without authentication');
    for (const response of [
      { status: 500, json: { message: 'Local simulated configuration failure' } },
      { status: 200, json: { enabled: true, startsAt: 'invalid', endsAt: 'invalid' } },
    ]) {
      await visitor.route(`${origin}/api/black-friday`, route => route.fulfill(response));
      await visitor.goto(`${origin}/`);
      await metrics();
      if (await visitor.locator('.bf-hero,.bf-banner').count()) throw new Error('Configuration failure rendered campaign');
      await visitor.unroute(`${origin}/api/black-friday`);
    }
    const settings = await page.evaluate(async () => (await fetch('/api/admin/black-friday', { cache: 'no-store' })).json());
    await visitor.route(`${origin}/api/black-friday`, route => route.fulfill({ json: { ...settings, enabled: true, serverTime: new Date(Date.parse(settings.startsAt) - 90061000).toISOString() } }));
    await visitor.goto(`${origin}/`);
    await visitor.locator('.bf-hero').waitFor({ state: 'visible' });
    await visitor.locator('#profileBtn').click();
    await visitor.locator('#authOverlay[aria-hidden="false"]').waitFor({ state: 'visible' });
    const z = await visitor.evaluate(() => ({ dialog: Number(getComputedStyle(document.querySelector('#authOverlay')).zIndex), campaign: Number(getComputedStyle(document.querySelector('.bf-banner')).zIndex) }));
    if (z.dialog <= z.campaign) throw new Error('Campaign covers login dialog');
    await visitor.locator('#authCloseBtn').click();
    await visitor.locator('#authOverlay[aria-hidden="true"]').waitFor({ state: 'hidden' });
    return { passed: ['disabled geometry/media match original page', 'no campaign placeholders', 'admin authentication enforced', 'configuration 500 and invalid dates fail open', 'login dialog opens/closes above campaign'] };
  } finally { await context.close(); }
}
