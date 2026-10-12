async (page) => {
  await page.addInitScript(() => { window.__CRONOX_API_BASE__ = location.origin; });
  const errors = [];
  const confirmations = [];
  page.removeAllListeners('dialog');
  page.on('dialog', dialog => { confirmations.push(dialog.message()); return dialog.accept(); });
  page.on('pageerror', error => errors.push(error.message));
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  await page.reload();
  await page.getByRole('tablist').getByRole('button', { name: 'Pedidos', exact: true }).click();
  await page.locator('#ordersBody tr').first().waitFor();
  const read = () => page.evaluate(async () => {
    const orders = await window.CRONOX_API.admin.listAdminOrders({ userId: new URLSearchParams(location.search).get('id') });
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const finance = await fetch(`/api/admin/finance?from=${day}&to=${day}&source=manual`, { credentials: 'include' }).then(r => r.json());
    return { orders: orders.items || orders.data || orders, totals: finance.totals, count: finance.salesCount };
  });
  const results = [];
  for (const [width, height, label] of [[1440, 1000, 'desktop'], [390, 844, 'mobile']]) {
    await page.setViewportSize({ width, height });
    const before = await read();
    await page.getByRole('button', { name: 'Nueva compra', exact: true }).click();
    check(!await page.getByRole('checkbox', { name: 'Excluir de las estadísticas', exact: true }).isChecked(), 'Default must include');
    await page.getByRole('combobox', { name: 'Artículo y talla' }).selectOption('1');
    await page.getByRole('textbox', { name: 'Precio pagado por unidad (€)' }).fill('25,50');
    await page.getByRole('spinbutton', { name: 'Cantidad' }).fill('2');
    await page.getByRole('combobox', { name: 'Tratamiento de stock' }).selectOption('ALREADY_ADJUSTED');
    await page.getByRole('checkbox', { name: 'Excluir de las estadísticas', exact: true }).check();
    await page.getByRole('button', { name: 'Revisar compra', exact: true }).click();
    await page.locator('#manualPurchaseReview').waitFor();
    check((await page.locator('#manualPurchaseReview').textContent()).includes('Excluida de estadísticas'), 'Review misses exclusion');
    await page.screenshot({ path: `output/playwright/manual-statistics-${label}-review.png`, fullPage: true });
    const response = page.waitForResponse(r => r.url().endsWith('/in-person-purchases') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Confirmar y registrar' }).click();
    const saved = await (await response).json();
    check(saved.order?.excludedFromStatistics === true, 'Saved choice not persisted');
    const id = String(saved.order.id);
    const action = page.locator(`[data-statistics-order="${id}"]`);
    await action.waitFor();
    const after = await read();
    check(JSON.stringify(after.totals) === JSON.stringify(before.totals) && after.count === before.count, 'Excluded creation changes statistics');
    await page.reload();
    await page.getByRole('tablist').getByRole('button', { name: 'Pedidos', exact: true }).click();
    await page.locator(`[data-statistics-order="${id}"]`).waitFor();
    check(await page.locator(`[data-statistics-order="${id}"]`).textContent() === 'Incluir en estadísticas', 'Choice lost after reload');
    // Real confirmation and HTTP mutation, not re-registration.
    const includeResponse = page.waitForResponse(r => r.url().endsWith('/statistics-exclusion') && r.request().method() === 'POST');
    await page.locator(`[data-statistics-order="${id}"]`).click();
    check((await includeResponse).ok(), 'Inclusion API failed');
    await page.locator(`[data-statistics-order="${id}"][data-excluded="false"]`).waitFor();
    const included = await read();
    check(included.totals.revenueCents === before.totals.revenueCents + 5100 && included.totals.profitCents === before.totals.profitCents + 2100 && included.count === before.count + 1, 'Inclusion totals differ');
    const excludeResponse = page.waitForResponse(r => r.url().endsWith('/statistics-exclusion') && r.request().method() === 'POST');
    await page.locator(`[data-statistics-order="${id}"]`).click();
    check((await excludeResponse).ok(), 'Exclusion API failed');
    await page.locator(`[data-statistics-order="${id}"][data-excluded="true"]`).waitFor();
    const excluded = await read();
    check(JSON.stringify(excluded.totals) === JSON.stringify(before.totals) && excluded.count === before.count, 'Re-exclusion does not restore totals');
    check(excluded.orders.length === before.orders.length + 1, 'Toggle duplicated the purchase');
    await page.screenshot({ path: `output/playwright/manual-statistics-${label}-saved.png`, fullPage: true });
    results.push({ label, orderId: id, review: true, persisted: true, includedProfitDeltaCents: 2100, excludedDeltaCents: 0 });
  }
  check(errors.length === 0, 'JavaScript errors: ' + errors.join('; '));
  return { results, errors, confirmations };
}
