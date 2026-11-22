'use strict';
const assert = require('node:assert/strict');
const { chromium, expect } = require('@playwright/test');
const env = require('./start-local.cjs').loadLocalEnvironment();
Object.assign(process.env, env);
const db = new (require('@prisma/client').PrismaClient)();
const baseURL = 'http://localhost:3000';
async function snapshot() {
  const tables = [
    'ProductVariant',
    'InventoryLotSlice',
    'InventoryLotAllocation',
    'StockMovement',
    'CheckoutStockReservation',
    'Order',
    'OrderItem',
    'PointSale',
    'PointEntry',
    'SalePoint',
    'historial',
    'QrEventParticipant',
    'PhysicalBarcode',
  ];
  const hashes = {};
  for (const table of tables)
    hashes[table] = (
      await db.$queryRawUnsafe(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) AS hash FROM "${table}" t`,
      )
    )[0].hash;
  return hashes;
}
async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const ctx = await browser.newContext({
      baseURL,
      viewport: { width: 1440, height: 980 },
    });
    const req = ctx.request;
    assert.equal((await req.get('/api/admin/register/catalog')).status(), 401);
    const { csrfToken } = await (await req.get('/api/auth/csrf')).json();
    assert.ok(
      (
        await req.post('/api/auth/login', {
          headers: { Origin: baseURL, 'X-CSRF-Token': csrfToken },
          data: {
            email: env.LOCAL_ADMIN_EMAIL || 'admin@cronox.local',
            password: env.LOCAL_ADMIN_PASSWORD,
          },
        })
      ).ok(),
    );
    const before = await snapshot();
    const member = await db.user.findFirstOrThrow({
      where: {
        role: 'USER',
        accountState: 'ACTIVE',
        circleLevel: { gte: 1, lte: 5 },
        publicMemberToken: { not: null },
      },
      select: { publicMemberToken: true, email: true },
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(7000);
    await page.addInitScript(() =>
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => {
          throw new DOMException('denied', 'NotAllowedError');
        },
      }),
    );
    await page.goto('/admin.html#section-register');
    const root = page.locator('#section-register'),
      act = (s) => root.locator('[data-act="' + s + '"]');
    const status = root.locator('#register-feedback'),
      footer = root.locator('aside footer');
    await act('purchase').click();
    await act('no-event').click();
    await act('guest').click();
    const input = root.locator('input[name=code]');
    const scan = async (value) => {
      await input.fill(value);
      await input.press('Enter');
    };
    await scan('CRX9999999999');
    await expect(status).toContainText('desconocido');
    await scan('CRX0000000009');
    if (await act('lot').first().isVisible()) await act('lot').first().click();
    await expect(footer).toContainText('1 uds.');
    await scan('CRX0000000009');
    await expect(footer).toContainText('2 uds.');
    await act('manual').click();
    await root.locator('input[name=q]').fill('CORE');
    await root.getByRole('button', { name: 'Buscar', exact: true }).click();
    const product = root
      .locator('details')
      .filter({ hasText: 'BLACK' })
      .first();
    await product.locator('summary').click();
    await product
      .locator('select')
      .selectOption(
        await product
          .locator('option:not([disabled])')
          .first()
          .getAttribute('value'),
      );
    await product.locator('input').fill('2');
    await product.getByRole('button', { name: 'Añadir' }).click();
    await expect(footer).toContainText('4 uds.');
    const evidence = require('node:path').resolve(
      __dirname,
      '../../output/playwright/register',
    );
    require('node:fs').mkdirSync(evidence, { recursive: true });
    await root.screenshot({
      path: require('node:path').join(evidence, 'caja-escritorio.png'),
    });
    assert.equal(await root.locator('.register-line').count(), 2);
    await act('minus').last().click();
    await expect(footer).toContainText('3 uds.');
    await act('back').click();
    await act('back').click();
    await act('event').click();
    await act('point').first().click();
    await act('credential').click();
    await expect(status).toContainText('denegado');
    await scan('incorrecto');
    await expect(status).toContainText('QR no válido');
    await scan('missing-account@cronox.invalid');
    await expect(status).toContainText('No se ha encontrado ninguna cuenta');
    await scan('invalid@');
    await expect(status).toContainText('correo');
    await input.fill('  ' + member.email.toUpperCase() + '  ');
    await root
      .getByRole('button', { name: 'Identificar', exact: true })
      .click();
    await expect(act('manual')).toBeVisible();
    await expect(root.locator('aside p').first()).toContainText(member.email);
    await act('back').click();
    await act('credential').click();
    await scan(member.email);
    await expect(act('manual')).toBeVisible();
    await act('back').click();
    await act('credential').click();
    await scan('CRX:1:' + member.publicMemberToken);
    await expect(act('manual')).toBeVisible();
    await expect(footer).toContainText('3 uds.');
    await expect(root.locator('aside p').first()).not.toContainText('Invitado');
    await act('back').click();
    await act('guest').click();
    await expect(root.locator('aside p').first()).toContainText('Invitado');
    await page.setViewportSize({ width: 390, height: 844 });
    await act('ticket').click();
    await expect(root.locator('aside')).toBeFocused();
    await root.screenshot({
      path: require('node:path').join(evidence, 'caja-movil.png'),
    });
    assert.ok(
      await root.evaluate(
        (el) => el.getBoundingClientRect().right <= innerWidth + 1,
      ),
    );
    await act('remove').last().click();
    await expect(footer).toContainText('2 uds.');
    await act('scan').click();
    await expect(status).toContainText('denegado');
    const delayed = page.waitForRequest((r) =>
      r.url().endsWith('/register/barcode'),
    );
    let resume;
    const gate = new Promise((resolve) => {
      resume = resolve;
    });
    await page.route('**/register/barcode', async (route) => {
      await gate;
      await route.continue();
    });
    await scan('CRX0000000009');
    await delayed;
    await act('reset').click();
    await root.locator('[data-cancel-confirm]').click();
    resume();
    await expect(act('purchase')).toBeVisible();
    await act('purchase').click();
    await act('no-event').click();
    await act('guest').click();
    await expect(footer).toContainText('0 uds.');
    await page.unroute('**/register/barcode');
    const png = await require('bwip-js').toBuffer({
      bcid: 'code128',
      text: 'CRX0000000009',
      scale: 3,
      height: 12,
      paddingwidth: 12,
      backgroundcolor: 'FFFFFF',
    });
    const qr = await require('qrcode').toDataURL(
      'CRX:1:' + member.publicMemberToken,
    );
    await page.evaluate(
      async (source) => {
        Object.defineProperty(window, 'BarcodeDetector', {
          configurable: true,
          value: undefined,
        });
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 480;
        const g = canvas.getContext('2d');
        window.showRegisterFrame = async (src) => {
          const image = new Image();
          image.src = src;
          await image.decode();
          g.fillStyle = 'white';
          g.fillRect(0, 0, 640, 480);
          g.drawImage(image, (640 - image.width) / 2, (480 - image.height) / 2);
        };
        await window.showRegisterFrame(source);
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          value: async () => {
            const stream = canvas.captureStream(12);
            window.registerTrack = stream.getVideoTracks()[0];
            const timer = setInterval(() => g.fillRect(0, 0, 1, 1), 80);
            const track = window.registerTrack;
            const original = track.stop.bind(track);
            track.stop = () => {
              clearInterval(timer);
              original();
            };
            return stream;
          },
        });
      },
      'data:image/png;base64,' + png.toString('base64'),
    );
    await act('camera').click();
    await expect(footer).toContainText('1 uds.');
    await page.waitForTimeout(1300);
    await expect(footer).toContainText('1 uds.');
    await act('back').click();
    assert.equal(
      await page.evaluate(() => window.registerTrack.readyState),
      'ended',
    );
    await page.evaluate((src) => window.showRegisterFrame(src), qr);
    let identifications = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/register/customer')) identifications++;
    });
    await act('credential').click();
    await expect(act('manual')).toBeVisible();
    await page.waitForTimeout(800);
    assert.equal(identifications, 1);
    // Subsequent scenarios exercise manual entry; don't let the synthetic QR
    // still in the canvas race the deliberate keyboard/network-error inputs.
    await page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async () => { throw new DOMException('denied', 'NotAllowedError'); },
      });
    });
    assert.equal(
      await page.evaluate(() => window.registerTrack.readyState),
      'ended',
    );
    await expect(footer).toContainText('1 uds.');
    await act('back').click();
    await act('credential').click();
    await page.route('**/register/customer', (route) => route.abort());
    await scan(member.email);
    await expect(root.locator('[data-identification-status]')).not.toBeEmpty();
    await expect(act('manual')).toHaveCount(0);
    await expect(input).toHaveValue(member.email);
    await page.unroute('**/register/customer');
    await scan(member.email);
    await expect(act('manual')).toBeVisible();
    await act('back').click();
    await act('credential').click();
    let releaseIdentity;
    const identityGate = new Promise((resolve) => {
      releaseIdentity = resolve;
    });
    await page.route('**/register/customer', async (route) => {
      await identityGate;
      await route.continue();
    });
    const started = page.waitForRequest((r) =>
      r.url().endsWith('/register/customer'),
    );
    await scan(member.email);
    await started;
    await act('reset').click();
    await root.locator('[data-cancel-confirm]').click();
    releaseIdentity();
    await expect(act('purchase')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(act('purchase')).toBeVisible();
    await page.unroute('**/register/customer');
    const lotReport = await db.physicalLotBarcode.findFirstOrThrow({
      where: {
        variant: {
          stockQty: { gte: 1 },
          isActive: true,
          product: { isActive: true },
        },
        lot: { archived: false },
      },
      orderBy: { createdAt: 'asc' },
    });
    await act('purchase').click();
    await act('no-event').click();
    await act('guest').click();
    await scan(lotReport.code);
    await expect(footer).toContainText('1 uds.');
    await expect(act('lot')).toHaveCount(0);
    const sharedCode = await db.physicalLotBarcode.findFirstOrThrow({
      where: {
        code: { startsWith: 'CRX' },
        variant: {
          stockQty: { gte: 1 },
          isActive: true,
          product: { isActive: true },
        },
        lot: { archived: false },
      },
    });
    await scan(sharedCode.code);
    await expect(footer).toContainText('2 uds.');
    await expect(act('lot')).toHaveCount(0);
    // Simulate an offer changing at the API boundary to exercise the visible periodic reprice.
    await page.route('**/register/quote', async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      data.items = data.items.map((l) => ({
        ...l,
        previousPriceCents: l.unitPriceCents,
        unitPriceCents: l.unitPriceCents - 100,
        subtotalCents: (l.unitPriceCents - 100) * l.quantity,
      }));
      data.totalCents = data.items.reduce((n, l) => n + l.subtotalCents, 0);
      await route.fulfill({ response, json: data });
    });
    await expect(root.locator('aside del').first()).toBeVisible({ timeout: 15000 });
    await expect(status).toContainText('actualizado');
    await page.unroute('**/register/quote');
    await page.goto('/admin.html#section-labels');
    const labels = page.locator('#physicalLabels');
    const checkbox = labels.locator(
      '[data-variant="' + lotReport.variantId + '|' + lotReport.lotId + '"]',
    );
    await checkbox
      .locator('xpath=ancestor::details')
      .locator('summary')
      .click();
    await checkbox.check();
    await labels.locator('[data-action=generate]').click();
    await expect(labels.locator('[data-action-message]')).toContainText(
      'guardados',
    );
    const download = page.waitForEvent('download');
    await labels.locator('[data-action=pdf]').click();
    await (
      await download
    ).saveAs(
      require('node:path').resolve(
        __dirname,
        '../../output/playwright/register-lot-labels/browser-lot-label.pdf',
      ),
    );
    assert.deepEqual(await snapshot(), before);
    console.log(
      'PASS: real local register, manual + keyboard scans, guest + credential, points, errors, camera denial, reset race, 390/1440px and unchanged business tables.',
    );
  } finally {
    await browser.close();
  }
}
main()
  .catch((e) => {
    console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
