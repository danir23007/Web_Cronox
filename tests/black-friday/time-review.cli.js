async (page) => {
  const origin = 'http://localhost:3000';
  if (new URL(page.url()).origin !== origin) throw new Error('Local review only');
  // Virtual time is confined to this browser. No saved dates or enabled flags are changed.
  const settings = await page.evaluate(async () => (await fetch('/api/admin/black-friday', { cache: 'no-store' })).json());
  const before = Date.parse(settings.startsAt) - 2000;
  const context = await page.context().browser().newContext({ serviceWorkers: 'block' });
  const virtual = await context.newPage();
  await virtual.clock.install({ time: new Date(before) });
  let serverNow = before;
  let adminContext;
  await virtual.route(`${origin}/api/black-friday`, route => route.fulfill({ json: { ...settings, enabled: true, serverTime: new Date(serverNow).toISOString() } }));
  try {
    await virtual.goto(`${origin}/`);
    await virtual.locator('.bf-hero').waitFor({ state: 'visible' });
    if (await virtual.locator('.bf-hero .bf-clock-label').innerText() !== 'EMPIEZA EN') throw new Error('Missing before state');
    serverNow += 2500;
    await virtual.clock.fastForward(2500);
    await virtual.waitForFunction(() => document.querySelector('.bf-banner .bf-clock-label')?.textContent === 'TERMINA EN').catch(error => { throw new Error(`Start transition: ${error.message}`); });
    if (await virtual.locator('.bf-hero,.bf-host').count()) throw new Error('Start retained hero campaign');
    for (const y of [300, 0]) {
      await virtual.evaluate(y => scrollTo(0, y), y);
      await virtual.clock.runFor(40);
      if (await virtual.locator('.bf-hero').count() || !await virtual.locator('.bf-banner').isVisible()) throw new Error('Event scroll restored large counter');
    }
    serverNow = Date.parse(settings.startsAt) + 3600000;
    await virtual.reload();
    await virtual.locator('.bf-banner').waitFor({ state: 'visible' });
    if (await virtual.locator('.bf-hero').count()) throw new Error('Direct event entry restored large counter');
    if (await virtual.locator('.bf-banner .bf-text').textContent() !== settings.bannerText) throw new Error('Event marquee text changed');
    const end = Date.parse(settings.endsAt);
    // Simulate a suspended background tab: one elapsed-time jump, not one tick per second.
    serverNow = end + 1000;
    await virtual.clock.fastForward(end - before + 1000);
    await virtual.locator('.bf-hero,.bf-banner').waitFor({ state: 'detached' });
    if (await virtual.locator('html').evaluate(el => el.classList.contains('bf-active'))) throw new Error('Expired campaign left overrides');
    adminContext = await page.context().browser().newContext({ serviceWorkers: 'block', storageState: await page.context().storageState() });
    const admin = await adminContext.newPage();
    await admin.route(`${origin}/api/admin/black-friday`, route => route.fulfill({ json: { ...settings, enabled: true, serverTime: new Date(end + 1000).toISOString() } }));
    await admin.goto(`${origin}/admin.html#section-key-screen`);
    await admin.waitForFunction(() => document.querySelector('#bfAdminStatus')?.textContent.includes('Finalizada'));
    if (!await admin.locator('#bfAdminForm [name="enabled"]').isChecked()) throw new Error('Expired campaign lost its saved enabled flag');
    return { passed: ['start removes hero without reload', 'TERMINA EN with unchanged marquee', 'event scroll never restores hero', 'direct event entry/reload stays compact', 'large background-time jump', 'end without reload restores original layout', 'admin shows Finalizada while switch remains enabled'], savedConfigurationChanged: false };
  } finally {
    await context.close();
    await adminContext?.close();
  }
}
