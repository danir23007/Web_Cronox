async (page) => {
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  await page.reload();
  await page.locator('#salePointsRoot h1').waitFor();
  const destinations = await page.locator('#adminSidebar [data-nav-target]').evaluateAll(nodes => nodes.map(node => node.dataset.navTarget));
  const customer = await page.evaluate(async () => {
    const result = await window.CRONOX_API.admin.getUserList({ sort: 'id', order: 'asc' });
    return result.data.find(user => user.id === 2);
  });
  const paths = [...destinations.map(id => `/admin.html#${id}`), '/admin.html#section-23', '/admin.html#section-34',
    '/admin.html#section-products-menu', '/admin.html#section-gallery',
    `/admin-user.html?id=${customer.id}&uid=${customer.identityUid}`, '/admin-launch.html', '/admin#section-dashboard', '/admin/#section-money'];
  const results = [];
  for (const role of ['SUPERADMIN', 'ADMIN']) {
    await page.goto(`http://127.0.0.1:43122/__review/menu?role=${role}`);
    await page.locator('#salePointsRoot .pos-list').waitFor();
    const access = await page.evaluate(async () => ({ role: (await fetch('/api/me', { credentials: 'include' }).then(r => r.json())).role,
      pointsStatus: (await fetch('/api/admin/sale-points', { credentials: 'include' })).status }));
    check(access.role === role && access.pointsStatus === 200, 'Authenticated role/points permission mismatch');
    for (const [width, height, label] of [[1440, 1000, 'desktop'], [390, 844, 'mobile']]) {
      await page.setViewportSize({ width, height });
      for (const path of paths) {
        await page.goto('http://127.0.0.1:43122' + path);
        await page.waitForFunction(() => !document.querySelector('#adminSidebar [data-nav-target="section-sale-points"]')?.hidden);
        if (width < 800) await page.locator('#sidebarToggle').click();
        const group = page.locator('#adminSidebar [aria-controls="navCliente"]');
        if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
        const option = page.locator('#navCliente [data-nav-target="section-sale-points"]');
        check(await option.isVisible(), `${role}/${label}/${path}: points option absent`);
        await option.click();
        await page.locator('#salePointsRoot .pos-list').waitFor();
        check(page.url().includes('/admin.html#section-sale-points'), `${path}: wrong target`);
        check(await page.locator('#navCliente [data-nav-target="section-sale-points"]').getAttribute('aria-current') === 'page', `${path}: active option missing`);
        check(await page.locator('[aria-controls="navCliente"]').getAttribute('aria-expanded') === 'true', `${path}: clients group not expanded`);
        await page.reload();
        await page.locator('#salePointsRoot .pos-list').waitFor();
        check(await page.locator('#navCliente [data-nav-target="section-sale-points"]').getAttribute('aria-current') === 'page', `${path}: active option lost on reload`);
        await page.goBack();
        await page.locator('#adminSidebar').waitFor({ state: 'attached' });
        const sourcePath = path.split('#')[0].split('?')[0];
        check(new URL(page.url()).pathname === (['/admin', '/admin/'].includes(sourcePath) ? '/admin.html' : sourcePath), `${path}: back navigation wrong page`);
        if (path === '/admin-launch.html' || path.startsWith('/admin-user.html')) {
          // Both independent documents use the same ordered menu, not a subset.
          const actual = await page.locator('#adminSidebar [data-nav-target]').evaluateAll(nodes => nodes.map(node => node.dataset.navTarget));
          check(JSON.stringify(actual) === JSON.stringify(destinations), `${path}: divergent menu`);
          if (width < 800 && !await page.locator('body').evaluate(body => body.classList.contains('sidebar-open'))) await page.locator('#sidebarToggle').click();
          const clients = page.locator('[aria-controls="navCliente"]');
          if (await clients.getAttribute('aria-expanded') !== 'true') await clients.click();
          await page.screenshot({ path: `output/playwright/admin-menu-${role}-${label}-${path.startsWith('/admin-user') ? 'user' : 'launch'}.png`, fullPage: false });
        }
      }
      results.push({ role, viewport: label, paths: paths.length, pointsLoaded: true, highlight: true, reload: true, back: true });
    }
  }
  check(errors.length === 0, 'JavaScript errors: ' + errors.join('; '));
  return { results, destinations, errors };
}
