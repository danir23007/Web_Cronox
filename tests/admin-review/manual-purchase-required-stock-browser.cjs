async (page) => {
  if (new URL(page.url()).origin !== 'http://127.0.0.1:43122') throw new Error('Disposable local server required');
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.removeAllListeners('dialog');
  page.on('dialog', dialog => dialog.accept());
  const read = () => page.evaluate(async () => {
    const id = new URLSearchParams(location.search).get('id');
    const api = window.CRONOX_API.admin;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [detail, list, orders, options, finance] = await Promise.all([
      api.getUserDetail(id), api.listUsers({ q: 'buyer@statistics.test' }),
      api.listAdminOrders({ userId: id }), api.getInPersonPurchaseOptions(id),
      fetch(`/api/admin/finance?from=${day}&to=${day}&source=manual`).then(r => r.json()),
    ]);
    return { spent: detail.stats.totalSpent, listSpent: list.data[0].revenueCents / 100,
      orders: orders.items || orders.data || orders, totals: finance.totals,
      stock: options.products.flatMap(p => p.variants.map(v => [v.id, v.stockQty])) };
  });
  const results = [];
  for (const [width, height, label, choice] of [[1440, 1000, 'desktop', 'ALREADY_ADJUSTED'], [390, 844, 'mobile', 'DEDUCT_NOW']]) {
    await page.setViewportSize({ width, height });
    await page.reload();
    await page.getByRole('tablist').getByRole('button', { name: 'Pedidos', exact: true }).click();
    const before = await read();
    check(before.spent === before.listSpent, 'List and detail differ');
    await page.locator('#toggleManualPurchase').click();
    check(await page.locator('#manualStockHandling').inputValue() === '', 'New purchase has a stock default');
    await page.locator('[data-manual-variant]').selectOption('1');
    await page.locator('[data-manual-price]').fill('30');
    await page.locator('#reviewManualPurchase').click();
    check(await page.locator('#manualStockHandlingError').isVisible(), 'Missing inline stock error');
    check(await page.locator('#manualStockHandlingError').textContent() === 'Selecciona cómo se debe tratar el stock', 'Wrong inline error');
    check(!await page.locator('#manualPurchaseReview').isVisible(), 'Review accepted missing stock');
    await page.locator('#manualStockHandling').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/required-stock-${label}-error.png`, fullPage: true });
    await page.locator('#manualPurchaseForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    const blocked = await read();
    check(blocked.orders.length === before.orders.length && JSON.stringify(blocked.stock) === JSON.stringify(before.stock), 'Invalid purchase changed data');
    await page.locator('#manualStockHandling').selectOption(choice);
    await page.locator('#manualExcludeStatistics').check();
    await page.locator('#reviewManualPurchase').click();
    await page.locator('#editManualPurchase').click();
    check(await page.locator('#manualStockHandling').inputValue() === choice, 'Stock choice lost on returning from review');
    await page.locator('#reviewManualPurchase').click();
    await page.locator('#manualPurchaseReview').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `output/playwright/required-stock-${label}-review.png`, fullPage: true });
    const response = page.waitForResponse(r => r.url().endsWith('/in-person-purchases') && r.request().method() === 'POST');
    await page.locator('#confirmManualPurchase').click();
    const saved = await (await response).json();
    check(saved.created && saved.order.excludedFromStatistics, 'Purchase did not persist');
    const id = saved.order.id;
    await page.locator(`[data-statistics-order="${id}"]`).waitFor();
    const after = await read();
    check(after.spent === before.spent + 30 && after.listSpent === after.spent, 'Excluded purchase omitted from spending');
    check(after.orders.length === before.orders.length + 1 && JSON.stringify(after.totals) === JSON.stringify(before.totals), 'Excluded sale leaked into general finance or duplicated');
    check(after.stock.find(v => v[0] === 1)[1] === before.stock.find(v => v[0] === 1)[1] - (choice === 'DEDUCT_NOW' ? 1 : 0), 'Wrong stock treatment');
    await page.reload();
    await page.getByRole('tablist').getByRole('button', { name: 'Pedidos', exact: true }).click();
    const reloaded = await read();
    check(reloaded.spent === after.spent && reloaded.listSpent === after.spent, 'Spending lost after reload');
    for (const excluded of [false, true]) {
      const reply = page.waitForResponse(r => r.url().endsWith('/statistics-exclusion') && r.request().method() === 'POST');
      await page.locator(`[data-statistics-order="${id}"]`).click();
      check((await reply).ok(), 'Statistics toggle failed');
      await page.locator(`[data-statistics-order="${id}"][data-excluded="${excluded}"]`).waitFor();
      const toggled = await read();
      check(toggled.spent === after.spent && toggled.listSpent === after.spent, 'Inclusion changed spending');
      check(toggled.totals.revenueCents === before.totals.revenueCents + (excluded ? 0 : 3000), 'General exclusion changed');
    }
    await page.screenshot({ path: `output/playwright/required-stock-${label}-saved.png`, fullPage: true });
    await page.locator('#toggleManualPurchase').click();
    check(await page.locator('#manualStockHandling').inputValue() === '', 'Previous selection reused');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal viewport overflow');
    results.push({ label, choice, initialBlank: true, missingSelectionBlocked: true, reviewPreserved: true,
      spent: after.spent, persistedAndListConsistent: true, exclusionUnchanged: true, stockCorrect: true });
  }
  check(errors.length === 0, errors.join('; '));
  const result = { results, pageErrors: errors };
  await page.evaluate(value => { window.__CRONOX_PURCHASE_REVIEW_RESULT__ = value; }, result);
  return result;
}
