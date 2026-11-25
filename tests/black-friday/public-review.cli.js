async (page) => {
  const origin = 'http://localhost:3000';
  if (new URL(page.url()).origin !== origin) throw new Error('Local review only');
  const settings = await page.evaluate(async () => (await fetch('/api/admin/black-friday', { cache: 'no-store' })).json());
  const context = await page.context().browser().newContext({ storageState: await page.context().storageState() });
  const visitor = await context.newPage();
  await visitor.route(`${origin}/api/black-friday`, route => route.fulfill({ json: { ...settings, enabled: true, serverTime: new Date(Date.parse(settings.startsAt) - 90061000).toISOString() } }));
  try { return await (async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  await page.goto(`${origin}/`);
  await page.locator('.bf-hero').waitFor({ state: 'visible' });
  const reject = page.getByRole('button', { name: 'RECHAZAR', exact: true });
  if (await reject.isVisible()) await reject.click();
  const image = await page.locator('#hero [data-media-placement]').getAttribute('src');
  const initial = await page.locator('.topbar').boundingBox();
  check(initial.y === 0, 'Topbar should start at the top of the hero');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('.bf-hero').waitFor({ state: 'visible' });
    await page.screenshot({ path: `output/black-friday/public-${width}-hero.png` });
    const doc = await page.locator('html').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    check(doc.scroll <= doc.client + 1, `Horizontal overflow at ${width}`);
    const contentTop = await page.locator('#store').evaluate(el => el.getBoundingClientRect().top + scrollY);
    await page.evaluate(() => scrollTo(0, 240));
    await page.locator('.bf-banner').waitFor({ state: 'visible' });
    await page.waitForFunction(() => Math.abs(document.querySelector('.topbar').getBoundingClientRect().top - document.querySelector('.bf-banner').getBoundingClientRect().bottom) < 1);
    check(Math.abs(contentTop - await page.locator('#store').evaluate(el => el.getBoundingClientRect().top + scrollY)) < 1, 'Scroll transition moved page content');
    await page.screenshot({ path: `output/black-friday/public-${width}-compact.png` });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('.bf-hero').waitFor({ state: 'visible' });
    await page.locator('.bf-banner').waitFor({ state: 'hidden' });
  }
  check(await page.locator('#hero [data-media-placement]').getAttribute('src') === image, 'Hero image was replaced');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 240));
  await page.locator('.bf-banner').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Buscar productos', exact: true }).click();
  await page.locator('#searchInput').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#searchBar').getBoundingClientRect().top >= document.querySelector('.topbar').getBoundingClientRect().bottom - 1);
  const bar = await page.locator('.topbar').boundingBox(), search = await page.locator('#searchBar').boundingBox();
  check(search.y >= bar.y + bar.height - 1, 'Search overlaps header stack');
  await page.locator('.searchbar__close').click();
  await page.getByRole('button', { name: 'Abrir menú', exact: true }).click();
  await page.locator('#filtersPanel.is-open').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Math.abs(document.querySelector('#filtersPanel').getBoundingClientRect().left) < 1);
  await page.screenshot({ path: 'output/black-friday/mobile-menu.png' });
  await page.keyboard.press('Escape');
  await page.locator('#filtersPanel.is-open').waitFor({ state: 'hidden' });
  await page.locator('#cart-icon-btn').click();
  await page.locator('#cart-drawer[aria-hidden="false"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#cart-drawer').getBoundingClientRect().right <= innerWidth + 1);
  await page.screenshot({ path: 'output/black-friday/mobile-cart.png' });
  await page.keyboard.press('Escape');
  await page.locator('#profileBtn').click();
  // A signed-in local administrator opens the existing account menu; no authentication flow is changed.
  await page.screenshot({ path: 'output/black-friday/mobile-profile.png' });
  await page.keyboard.press('Escape');
  for (const path of ['/tienda', '/favoritos', '/cesta', '/sobre-cronox', '/galeria', '/producto/scarred-tee-red']) {
    await page.goto(`${origin}${path}`);
    await page.locator('.bf-banner').waitFor({ state: 'visible' });
    check(await page.locator('.bf-hero').count() === 0, `Large counter on ${path}`);
    await page.waitForFunction(() => Math.abs(document.querySelector('.topbar').getBoundingClientRect().top - document.querySelector('.bf-banner').getBoundingClientRect().bottom) < 1);
    const doc = await page.locator('html').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
    check(doc.scroll <= doc.client + 1, `Interior overflow: ${path}`);
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(await page.locator('.bf-track').evaluate(el => getComputedStyle(el).animationName) === 'none', 'Reduced motion still animates');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  return { passed: ['hero/compact/restore at 1440, 390, 320px', 'stable content', 'image preserved', 'search/menu/cart', '6 interior routes', 'reduced motion'] };
  })(visitor); } finally { await context.close(); }
}
