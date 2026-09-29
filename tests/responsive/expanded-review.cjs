const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const { safety, layout, login, navigate, theme, screenshot, report, out, base } = require('./local-review.cjs');
async function run() {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ locale: 'es-ES' }); await safety(context);
    const page = await context.newPage(); page.on('pageerror', e => report.errors.push(e.message));
    await login(page);
    const original = await (await context.request.get(base + '/api/admin/finance?from=2026-09-01&to=2026-09-27&currency=EUR')).json();
    let financeState = 'populated';
    const products = Array.from({ length: 32 }, (_, index) => ({ productId: 99000 + index, name: 'Producto de prueba con nombre largo y colección de edición especial ' + index, imageUrl: '/assets/logo_banner.png', unitsSold: 200, unitsReturned: 3, revenueCents: 123456789, costCents: null, profitCents: null }));
    const order = { id: 99001, createdAt: '2026-09-12T12:00:00Z', paidAt: '2026-09-12T12:00:00Z', status: 'PAID', paymentStatus: 'PAID', total: 123456,
      userEmail: 'cliente-de-prueba-con-direccion-larga@example.test', customer: { name: 'Persona ficticia con un nombre y apellidos largos', email: 'fixture@example.test' },
      shippingAddress: { recipient: 'Persona ficticia', line1: 'Dirección ficticia para comprobar la disposición de texto largo', city: 'Ciudad ficticia', country: 'ES', postalCode: '00000' },
      shippingCarrier: 'Transportista de prueba', trackingNumber: 'PRUEBA-SIN-ENVIO', items: [{ title: 'Producto de prueba con nombre largo', variant: 'Talla XL', quantity: 2, lineTotal: 123456 }] };
    await page.route('**/api/admin/finance?**', async route => {
      if (financeState === 'loading') await new Promise(resolve => setTimeout(resolve, 1800));
      if (financeState === 'error') return route.fulfill({ status: 503, json: { message: 'Error de prueba' } });
      const query = new URL(route.request().url()).searchParams, pageNumber = Number(query.get('page') || 1);
      const filtered = query.get('search') ? products.filter(p => p.name.includes(query.get('search'))) : products;
      return route.fulfill({ json: { ...original, products: filtered.slice((pageNumber - 1) * 25, pageNumber * 25), topProducts: products.slice(0, 5),
        recentOrders: Array.from({ length: 5 }, (_, i) => ({ ...order, id: 99001 + i, totalCents: order.total })),
        totals: { revenueCents: 123456789, costCents: null, profitCents: null, unitsSold: 200, unitsReturned: 3 },
        buckets: original.buckets.map((b, i) => ({ ...b, revenueCents: i * 1234500, profitCents: i % 3 ? 123400 : null })),
        pagination: { page: pageNumber, pages: Math.ceil(filtered.length / 25), total: filtered.length, pageSize: 25 } } });
    });
    await page.route('**/api/admin/orders*', route => route.fulfill({ json: { data: [order], meta: { page: 1, total: 1, pageCount: 1, pageSize: 20 } } }));
    await page.route('**/api/admin/orders/99001', route => route.fulfill({ json: order }));
    report.fixtures.push('32 finance products, 5 recent orders, unknown historical costs, large totals, long labels; one fictional order. Responses only, no database writes.');
    for (const mode of ['light', 'dark']) {
      await theme(page, mode);
      for (const width of [320, 360, 430, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 740 }); await navigate(page, 'section-dashboard');
        await expect(page.locator('#section-dashboard .finance-row').first()).toBeVisible(); await layout(page, 'populated-summary', '#section-dashboard');
        await page.locator('.finance-chart').focus(); await page.keyboard.press('End');
        await expect(page.locator('.finance-tooltip')).toBeVisible(); await layout(page, 'chart-tooltip', '#section-dashboard');
        if ([320, 768, 1440].includes(width)) await screenshot(page, `populated-${mode}-dashboard-${width}`);
        await navigate(page, 'section-money'); await expect(page.locator('.finance-table tbody tr')).toHaveCount(25);
        await layout(page, 'populated-money', '#section-money');
        await page.locator('[data-sort]').selectOption('units:asc');
        await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
        await expect(page.locator('.finance-table tbody tr')).toHaveCount(7);
        await page.locator('[data-search]').fill('especial 31'); await expect(page.locator('.finance-table tbody tr')).toHaveCount(1);
        await navigate(page, 'section-orders'); await page.locator('[data-order-id="99001"]').click();
        await expect(page.locator('#orderDetailModal')).toBeVisible(); await layout(page, 'populated-order-dialog', '#orderDetailModal');
        await page.locator('#orderRefundBtn').scrollIntoViewIfNeeded(); await expect(page.locator('#orderRefundBtn')).toBeInViewport();
        await page.locator('#orderDetailClose').click();
      }
    }
    await page.setViewportSize({ width: 320, height: 568 });
    financeState = 'loading'; await navigate(page, 'section-dashboard'); await layout(page, 'finance-loading', '#section-dashboard');
    await expect(page.locator('.finance-chart svg')).toBeVisible();
    financeState = 'error'; await navigate(page, 'section-money'); await expect(page.locator('.finance-error')).toBeVisible(); await layout(page, 'finance-error', '#section-money');
    financeState = 'populated'; await page.locator('.finance-error button').click(); await expect(page.locator('.finance-table')).toBeVisible();
    report.interactions.push('populated finance, missing costs, chart keyboard, sort/search/pagination, loading/error/retry, order detail controls without actions');
    for (const mode of ['light', 'dark']) {
      await theme(page, mode);
      for (const width of [320, 768, 1440]) {
        await page.setViewportSize({ width, height: width === 320 ? 400 : 740 });
        await navigate(page, 'section-media'); await page.getByRole('button', { name: 'Editar encuadre', exact: true }).first().click();
        await expect(page.locator('#mediaEditorModal')).toBeVisible(); await layout(page, 'media-editor', '#mediaEditorModal');
        await page.locator('#mediaEditorModal').getByRole('button', { name: /Cancelar|Cerrar/, exact: false }).first().click();
        for (const mode of ['mosaic', 'carousel']) {
          await page.evaluate(mode => window.CRONOX_ADMIN_NAV.navigate('section-gallery-' + mode), mode);
          const container = page.locator(mode === 'mosaic' ? '#galleryMosaicEditor' : '#galleryCarouselEditor');
          await expect(container).toBeVisible();
          await page.waitForTimeout(200);
          await container.getByRole('button', { name: /^(Editar|Cambiar imagen|Añadir imagen)/ }).first().click();
          await expect(page.locator('#galleryEditorModal')).toBeVisible(); await layout(page, 'gallery-' + mode + '-editor', '#galleryEditorModal');
          await page.locator('#galleryEditorModal').getByRole('button', { name: /Cancelar|Cerrar/, exact: false }).first().click();
        }
      }
    }
    report.interactions.push('Tienda media and Mosaic/Carousel editors in both themes without saving/uploading');
    expect(report.errors).toEqual([]);
  } finally { await browser.close(); }
}
run().catch(error => { report.failure = error.stack; console.error(error.message); process.exitCode = 1; }).finally(() => {
  fs.writeFileSync(path.join(out, 'expanded-review.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ layouts: report.layouts.length, failure: !!report.failure }));
});
