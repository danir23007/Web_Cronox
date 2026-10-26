const { test, expect } = require('@playwright/test');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const QRCode = require('../../cronox-backend/node_modules/qrcode');

// Production HTML/CSS/scripts in real engines; only signed-in account responses,
// failed requests and the clock are simulated. No application data is written.
const artwork = readFileSync(path.resolve(__dirname, '../../cronox-front/assets/logo_banner.png'));
const design = { id: 'metacrilatos', renderer: 'metacrilatos-v1', config: { version: 1 } };
const romans = ['I', 'II', 'III', 'IV', 'V'];
const privileges = [
  ['Acreditación negra, miembro oficial de CRONOX. (sirve para eventos).'],
  ['Acreditación negra', 'Participación sorteo mensual de 2 códigos de descuento acumulables.'],
  ['Acreditación gris', 'Acceso anticipado en drops', 'Acceso a piezas especiales y exclusivas.'],
  ['Acreditación blanca', 'Acceso anticipado en drops', 'Acceso a piezas especiales y exclusivas', '10% de descuento permanente', 'Acceso a entradas para eventos privados', 'Posibilidad de salir en nuestra galería.'],
  ['Acreditación roja', 'Acceso anticipado en drops', 'Acceso a piezas especiales y exclusivas', '25% de descuento permanente', 'Entradas gratis a eventos privados', 'Posibilidad de recibir piezas especiales o regalos', 'Posibilidad de salir en nuestra galería'],
];
let qrDataUrl;
test.beforeAll(async () => {
  qrDataUrl = await QRCode.toDataURL('CRX:1:0123456789abcdef0123456789abcdef', {
    width: 592, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#49212c', light: '#e9d8c4' },
  });
});

async function setup(page, { heldStats = false, clock = false } = {}) {
  const state = { level: 1, pendingStats: [], errors: [], writes: [], credentialRequests: 0, statsRequests: 0 };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: clock ? 'no-preference' : 'reduce' });
  await page.route('https://**/*', route => route.fulfill({ contentType: 'image/png', body: artwork }));
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() !== 'GET') state.writes.push(pathname);
    if (pathname === '/api/accreditations/active') return json(design);
    if (pathname === '/api/membership/me/accreditation') {
      state.credentialRequests++;
      return json({ circleLevel: state.level, registrationNumber: 1, memberCode: 'CRX-000050', name: 'Daniel Rivas', createdAt: '2020-01-01T23:30:00Z',
        visibleId: '11111111-2222-4333-8444-555555555555', qrDataUrl });
    }
    // Deliberately stale cached profile and statistics circle: the authorized
    // credential alone determines both the approved variant and its privileges.
    if (pathname === '/api/me') return json({ id: 7, firstName: 'Daniel', memberCode: 'CRX-000007', circleLevel: 2 });
    if (pathname === '/api/membership/me/stats') {
      state.statsRequests++;
      if (heldStats) { state.pendingStats.push(route); return; }
      return json({ circleLevel: 2, pedidosRealizados: state.level === 1 ? 0 : 18,
        articulosAdquiridos: state.level === 1 ? 0 : 23, productosDiferentes: state.level === 1 ? 0 : 7 });
    }
    if (pathname.includes('circle-upgrade')) return json({ circleLevel: 2, hasPending: false, canRequest: false });
    if (pathname === '/api/me/address') return json(null);
    if (pathname === '/api/cart') return json({ items: [], itemsCount: 0, subtotal: 0 });
    if (pathname === '/api/me/orders' || pathname === '/api/favorites') return json([]);
    if (pathname === '/api/products') return json({ items: [] });
    return json({});
  });
  if (clock) {
    const epoch = new Date('2030-01-01T12:00:00Z');
    await page.clock.install({ time: epoch });
    await page.clock.pauseAt(epoch);
  }
  state.open = async level => {
    state.level = level;
    await page.goto('/profile.html');
    const reject = page.locator('.cronox-consent [data-consent-action="reject"]');
    if (await reject.isVisible()) await reject.click();
    await page.locator('[data-profile-tab="accreditation"]').click();
    await expect(page.locator('.crx-metacrilatos')).toBeVisible();
    await expect(page.locator('[data-metacrilatos-member]')).toBeVisible();
    await expect(page.locator('.crx-qr img')).toHaveJSProperty('complete', true);
  };
  return state;
}

function measureLayout() {
  const rect = selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top + scrollY, bottom: r.bottom + scrollY, width: r.width, height: r.height };
  };
  return {
    width: innerWidth, contentWidth: document.body.getBoundingClientRect().width,
    overflow: document.documentElement.scrollWidth > innerWidth,
    stage: rect('.crx-stage'), slab: rect('.crx-slab'), button: rect('[data-crx-flip]'),
    member: rect('[data-metacrilatos-member]'), history: rect('[data-meta-history]'),
    store: rect('[data-profile-section="accreditation"] [data-profile-back="store"]'),
    scale: Number(getComputedStyle(document.querySelector('.crx-metacrilatos')).getPropertyValue('--crx-scale')),
    slabWidth: document.querySelector('.crx-slab').offsetWidth,
    slabHeight: document.querySelector('.crx-slab').offsetHeight,
  };
}

// Drive the existing pointer handlers through every yaw and all supported tilt
// limits, measuring actual projected faces/rim panels rather than the stage box.
function sweepApprovedGeometry() {
  const stage = document.querySelector('.crx-stage');
  const slab = document.querySelector('.crx-slab');
  const button = document.querySelector('[data-crx-flip]');
  const member = document.querySelector('[data-metacrilatos-member]');
  const dispatch = (type, x, y) => stage.dispatchEvent(new PointerEvent(type,
    { bubbles: true, pointerId: 77, button: 0, clientX: x, clientY: y, pointerType: 'mouse' }));
  let px = 100, py = 100, buttonClearance = Infinity, memberClearance = Infinity;
  dispatch('pointerdown', px, py);
  const orientation = () => slab.style.transform.match(/rotateX\(([-\d.e]+)deg\) rotateY\(([-\d.e]+)deg\)/).slice(1).map(Number);
  for (const pitch of [-32, -19, -7, 0, 19, 32]) {
    py += (orientation()[0] - pitch) / .3;
    dispatch('pointermove', px, py);
    for (let yaw = 0; yaw <= 360; yaw += 10) {
      px += (yaw - orientation()[1]) / .65;
      dispatch('pointermove', px, py);
      const pieces = [...document.querySelectorAll('.crx-face, .crx-rim-panel')].map(el => el.getBoundingClientRect());
      const bottom = Math.max(...pieces.map(r => r.bottom));
      const right = Math.max(...pieces.map(r => r.right));
      buttonClearance = Math.min(buttonClearance, button.getBoundingClientRect().top - bottom);
      const details = member.getBoundingClientRect();
      memberClearance = Math.min(memberClearance, innerWidth >= 760 ? details.left - right : details.top - bottom);
    }
  }
  // Finish at the approved initial pose for the visual record.
  py += (orientation()[0] + 7) / .3;
  px += (-19 - orientation()[1]) / .65;
  dispatch('pointermove', px, py);
  dispatch('pointerup', px, py);
  return { buttonClearance, memberClearance };
}

test('five circles retain their real privileges and geometry in the desktop/mobile composition', async ({ page }, testInfo) => {
  test.setTimeout(90000);
  const state = await setup(page);
  const directory = path.resolve(__dirname, '../../output/playwright');
  mkdirSync(directory, { recursive: true });
  for (let level = 1; level <= 5; level++) {
    await state.open(level);
    const member = page.locator('[data-metacrilatos-member]');
    await expect(member).toHaveAttribute('data-circle-level', String(level));
    await expect(page.locator('[data-meta-circle]')).toHaveText(romans[level - 1]);
    await expect(page.locator('.metacrilatos-member__eyebrow')).toHaveText('TU STATUS EN CRONOX');
    await expect(page.locator('[data-meta-circle-marker][aria-current="true"]')).toHaveCount(1);
    await expect(page.locator(`[data-meta-circle-marker="${level}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(member.locator('[data-meta-circle-marker] button, [data-meta-circle-marker] a')).toHaveCount(0);
    await expect(member.locator('[data-meta-privileges] li')).toHaveText(privileges[level - 1]);
    await expect(page.locator('[data-meta-history]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('[data-meta-stat]')).toHaveText(level === 1 ? ['0', '0', '0'] : ['18', '23', '7']);
    await expect(member).not.toContainText('Daniel Rivas');
    await expect(member).not.toContainText('11111111-2222-4333-8444-555555555555');
    await expect(member.locator('img')).toHaveCount(0);
    await expect(page.locator('.crx-actions button')).toHaveCount(1);
    await expect(page.locator('[data-crx-auto]')).toHaveCount(0);
    const layout = await page.evaluate(measureLayout);
    expect(layout.overflow).toBe(false);
    expect(layout.slabWidth).toBe(layout.width <= 390 ? 250 : 264);
    expect(layout.slabHeight).toBe(layout.width <= 390 ? 400 : 414);
    expect(layout.button.left + layout.button.width / 2).toBeCloseTo(layout.stage.left + layout.stage.width / 2, 0);
    if (layout.width >= 760) {
      expect(layout.member.left).toBeGreaterThan(layout.stage.right);
      expect(Math.abs(layout.member.top - layout.slab.top)).toBeLessThan(80);
      expect(layout.store.left + layout.store.width / 2).toBeCloseTo(layout.contentWidth / 2, 0);
      // Readable customer text can make the information column taller than
      // the card. The shared return row must clear both complete columns.
      expect(layout.store.top).toBeGreaterThan(Math.max(layout.history.bottom, layout.button.bottom));
    } else {
      expect(layout.member.top).toBeGreaterThan(layout.button.bottom + 20);
      expect(layout.store.top).toBeGreaterThan(layout.history.bottom + 20);
    }
    const sweep = await page.evaluate(sweepApprovedGeometry);
    expect(sweep.buttonClearance).toBeGreaterThan(15);
    expect(sweep.memberClearance).toBeGreaterThan(20);
    await page.screenshot({ path: path.join(directory, `metacrilatos-details-${testInfo.project.name}-${level}.png`), fullPage: true });
  }
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('loading, failure, missing counts and retry preserve the mounted card, its held orientation and release deadline', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const state = await setup(page, { heldStats: true, clock: true });
  await state.open(5);
  const history = page.locator('[data-meta-history]');
  await expect(history).toHaveAttribute('data-state', 'loading');
  await expect(history).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('[data-meta-status]')).toBeVisible();
  await expect(page.locator('[data-meta-stat]')).not.toHaveText(['0', '0', '0']);
  await expect(page.locator('[data-meta-privileges] li')).toHaveText(privileges[4]);
  await page.screenshot({ path: path.resolve(__dirname, `../../output/playwright/metacrilatos-details-${testInfo.project.name}-loading.png`), fullPage: true });
  await page.locator('.crx-stage').scrollIntoViewIfNeeded();
  await page.clock.runFor(64);
  await page.evaluate(() => {
    window.detailsTestSlab = document.querySelector('.crx-slab');
    const stage = document.querySelector('.crx-stage');
    stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77, button: 0, clientX: 100, clientY: 100 }));
    stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 77, button: 0, clientX: 170, clientY: 120 }));
    window.detailsTestOrientation = window.detailsTestSlab.style.transform;
  });
  await expect.poll(() => state.pendingStats.length).toBe(1);
  await state.pendingStats.shift().fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Temporarily unavailable"}' });
  await expect(history).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-meta-retry]')).toBeVisible();
  await page.screenshot({ path: path.resolve(__dirname, `../../output/playwright/metacrilatos-details-${testInfo.project.name}-error.png`), fullPage: true });
  await page.clock.runFor(8500);
  expect(await page.evaluate(() => document.querySelector('.crx-slab') === window.detailsTestSlab
    && window.detailsTestSlab.style.transform === window.detailsTestOrientation)).toBe(true);
  await page.locator('[data-meta-retry]').click();
  await expect(history).toHaveAttribute('data-state', 'loading');
  await expect.poll(() => state.pendingStats.length).toBe(1);
  await state.pendingStats.shift().fulfill({ contentType: 'application/json', body: JSON.stringify({ circleLevel: 1, pedidosRealizados: 0 }) });
  await expect(history).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-meta-stat]')).not.toHaveText(['0', '0', '0']);
  await page.locator('[data-meta-retry]').click();
  await expect.poll(() => state.pendingStats.length).toBe(1);
  await state.pendingStats.shift().fulfill({ contentType: 'application/json', body: JSON.stringify({
    circleLevel: 1, ordersCount: 0, itemsNetCount: 0, distinctProductsCount: 0,
  }) });
  await expect(history).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('[data-meta-stat]')).toHaveText(['0', '0', '0']);
  await expect(page.locator('[data-meta-retry]')).toBeHidden();
  await expect(page.locator('[data-meta-circle]')).toHaveText('V');
  expect(state.credentialRequests).toBe(1);
  expect(state.statsRequests).toBe(3);
  expect(await page.evaluate(() => document.querySelector('.crx-slab') === window.detailsTestSlab
    && window.detailsTestSlab.style.transform === window.detailsTestOrientation)).toBe(true);
  await page.locator('.crx-stage').scrollIntoViewIfNeeded();
  await page.clock.runFor(64);
  await page.locator('.crx-stage').dispatchEvent('pointerup', { pointerId: 77, button: 0 });
  // Mouse release keeps the existing five-second hold (the same contract as
  // metacrilatos-motion.spec.cjs); history retries must not extend it.
  await page.clock.runFor(4900);
  expect(await page.evaluate(() => window.detailsTestSlab.style.transform === window.detailsTestOrientation)).toBe(true);
  await page.clock.runFor(180);
  expect(await page.evaluate(() => window.detailsTestSlab.style.transform !== window.detailsTestOrientation)).toBe(true);
  await page.evaluate(() => {
    const angle = () => Number(/rotateY\(([-\d.e]+)deg\)/.exec(window.detailsTestSlab.style.transform)[1]);
    window.detailsTestTurn = { start: angle(), end: angle(), minGap: Infinity, samples: 0, active: true };
    const sample = () => {
      const turn = window.detailsTestTurn;
      if (!turn.active) return;
      const bottom = Math.max(...[...document.querySelectorAll('.crx-face, .crx-rim-panel')].map(el => el.getBoundingClientRect().bottom));
      turn.minGap = Math.min(turn.minGap, document.querySelector('[data-crx-flip]').getBoundingClientRect().top - bottom);
      turn.end = angle(); turn.samples++;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.clock.runFor(17400); // One complete turn at the unchanged 21 degrees/second.
  const fullTurn = await page.evaluate(() => { window.detailsTestTurn.active = false; return window.detailsTestTurn; });
  expect(fullTurn.end - fullTurn.start).toBeGreaterThanOrEqual(360);
  expect(fullTurn.minGap).toBeGreaterThan(15);
  expect(fullTurn.samples).toBeGreaterThan(500);
  expect(state.errors).toEqual([]);
  expect(state.writes).toEqual([]);
});

test('long privilege text and history labels wrap without pushing the mobile store link into the content', async ({ page }, testInfo) => {
  const state = await setup(page);
  await state.open(5);
  await expect(page.locator('[data-meta-history]')).toHaveAttribute('data-state', 'ready');
  // Layout stress only: these DOM-only strings do not modify membership rules.
  await page.locator('[data-meta-privileges]').evaluate(list => {
    const original = list.firstElementChild.textContent;
    for (let index = 0; index < 9; index++) {
      const item = document.createElement('li');
      item.textContent = `${original} ${'Una descripción larga que debe conservar sus márgenes y separadores. '.repeat(4)}`;
      list.append(item);
    }
  });
  const layout = await page.evaluate(measureLayout);
  expect(layout.overflow).toBe(false);
  expect(await page.locator('[data-metacrilatos-member]').evaluate(member => [...member.querySelectorAll('*')]
    .filter(el => el.getClientRects().length > 0).every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  if (layout.width < 760) expect(layout.store.top).toBeGreaterThan(layout.history.bottom + 20);
  await page.screenshot({ path: path.resolve(__dirname, `../../output/playwright/metacrilatos-details-${testInfo.project.name}-long.png`), fullPage: true });
  expect(state.errors).toEqual([]);
});
