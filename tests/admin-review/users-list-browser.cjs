async (page) => {
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  await page.reload();
  await page.locator('#usersSort').waitFor();
  check(await page.locator('#usersSort').inputValue() === 'id' && await page.locator('#usersOrder').inputValue() === 'desc', 'Initial ordering must be ID descending');
  check(!page.url().includes('accountState'), 'Retired URL filter remains');
  check(await page.locator('#usersAccountState').count() === 0, 'Account state filter still exists');
  const headers = await page.locator('#section-users th').allTextContents();
  check(headers.indexOf('Facturación') === headers.indexOf('Nombre') + 1 && headers.indexOf('Rol') === headers.indexOf('Facturación') + 1, 'Revenue column is misplaced');
  const matches = response => new URL(response.url()).pathname === '/api/admin/users';
  const act = async fn => { const wait = page.waitForResponse(matches); await fn(); const response = await wait; check(response.ok(), 'Users endpoint failed'); const json = await response.json();
    await page.waitForFunction(() => !document.querySelector('#usersBody [data-ui-loading]') && document.querySelector('#usersBody a[href^="admin-user.html"]'));
    return json;
  };
  await act(() => page.locator('#usersSearch').fill('LIST local'));
  const all = await page.evaluate(async () => {
    const get = window.CRONOX_API.admin.getUserList || window.CRONOX_API.admin.listUsers;
    const first = await get({ q: 'LIST local', pageSize: 100, page: 1 });
    const second = await get({ q: 'LIST local', pageSize: 100, page: 2 });
    return [...first.data, ...second.data];
  });
  check(all.length === 106, 'Legacy state filter removed users');
  const results = [];
  for (const [width, height, label] of [[1440, 1000, 'desktop'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    const details = page.locator('#section-users details.filters-panel');
    if (await details.getAttribute('open') !== null) await details.locator('summary').click();
    check(await page.getByRole('combobox', { name: 'Ordenar por', exact: true }).isVisible(), 'Sort requires opening filters');
    check(await page.getByRole('combobox', { name: 'Dirección', exact: true }).isVisible(), 'Direction requires opening filters');
    for (const sort of ['id', 'revenue', 'orders', 'distinctProducts']) for (const order of ['desc', 'asc']) {
      const first = await act(async () => {
        await page.locator('#usersSort').selectOption(sort);
        await page.locator('#usersOrder').selectOption(order);
      });
      // Two changes can initiate requests; query the final state after the last
      // change, and wait until the corresponding latest response has rendered.
      const query = await page.evaluate(() => new URLSearchParams(location.hash.split('&').slice(1).join('&')).get('sort'));
      if (query !== `${sort}:${order}`) await page.waitForFunction(value => new URLSearchParams(location.hash.split('&').slice(1).join('&')).get('sort') === value, `${sort}:${order}`);
      const expected = [...all].sort((a, b) => {
        const field = { id: 'id', revenue: 'revenueCents', orders: 'ordersCount', distinctProducts: 'distinctProducts' }[sort];
        return (order === 'asc' ? a[field] - b[field] : b[field] - a[field]) || b.id - a.id;
      });
      await page.waitForFunction(id => Number(document.querySelector('#usersBody tr td')?.textContent) === id, expected[0].id);
      const numbers = await page.locator('#usersBody tr td:first-child').allTextContents();
      check(JSON.stringify(numbers.map(Number)) === JSON.stringify(expected.slice(0, 100).map(user => user.id)), `${label} ${sort}/${order}: first page order differs`);
      await act(() => page.locator('#usersNext').click());
      await page.waitForFunction(id => Number(document.querySelector('#usersBody tr td')?.textContent) === id, expected[100].id);
      const second = await page.locator('#usersBody tr td:first-child').allTextContents();
      check(JSON.stringify(second.map(Number)) === JSON.stringify(expected.slice(100).map(user => user.id)), `${label} ${sort}/${order}: second page order differs`);
      await act(() => page.locator('#usersPrev').click());
    }
    await details.locator('summary').click();
    await act(() => page.locator('#usersRole').selectOption('USER'));
    check(await page.locator('#usersSort').inputValue() === 'distinctProducts' && await page.locator('#usersOrder').inputValue() === 'asc', 'Filter reset sorting');
    await act(() => page.locator('#usersFiltersReset').click());
    check(await page.locator('#usersSort').inputValue() === 'distinctProducts', 'Clearing filters reset sorting');
    await act(() => page.locator('#usersSearch').fill('LIST local'));
    const row = page.locator('#usersBody tr').first();
    const text = await row.locator('td').allTextContents();
    check(text.some(value => value.replace(/\s/g, ' ') === '0,00 €'), 'Zero revenue is not formatted');
    const link = await row.getByRole('link', { name: 'Ver', exact: true }).getAttribute('href');
    check(link.includes('uid=') && link.includes('id='), 'Identity-protected action lost');
    await page.locator('#section-users').getByRole('button', { name: 'Bulk Edit', exact: true }).click();
    await page.locator('#usersBody input[data-bulk-id]').first().check();
    check((await page.locator('#section-users').textContent()).includes('1 seleccionados'), 'User selection broken');
    await page.locator('#section-users').getByRole('button', { name: 'Cancelar Bulk Edit', exact: true }).click();
    await page.locator('#usersSort').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/users-list-${label}.png`, fullPage: false });
    results.push({ label, sorts: 8, pagination: true, filterPersistence: true, selection: true, action: link });
  }
  await page.evaluate(() => { location.hash = '#section-money'; });
  await page.locator('#section-money').waitFor();
  await page.evaluate(() => { location.hash = '#section-users'; });
  await page.locator('#usersSort').waitFor();
  check(await page.locator('#usersSort').inputValue() === 'id' && await page.locator('#usersOrder').inputValue() === 'desc', 'Re-entry retained old sorting');
  check(errors.length === 0, errors.join('; '));
  return { results, initial: 'id:desc', reentry: 'id:desc', retiredFilterAbsent: true, errors };
}
