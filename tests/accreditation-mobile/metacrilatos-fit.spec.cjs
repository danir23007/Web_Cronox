const { test, expect } = require('@playwright/test');
const { readFileSync } = require('node:fs');
const QRCode = require('../../cronox-backend/node_modules/qrcode');

// Account responses and time are simulated. The page, renderer, layout and QR
// reader are production code running in a real browser; no account is written.
const token = 'CRX:1:0123456789abcdef0123456789abcdef';
const artwork = readFileSync('cronox-front/assets/logo_banner.png');
let qrDataUrl;
test.beforeAll(async () => {
  qrDataUrl = await QRCode.toDataURL(token, { width: 592, margin: 4, errorCorrectionLevel: 'M',
    color: { dark: '#49212c', light: '#e9d8c4' } });
});

async function openProfile(page, { clock = false } = {}) {
  const state = { level: 5, credentials: 0, errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: clock ? 'no-preference' : 'reduce' });
  await page.route('https://**/*', route => route.fulfill({ contentType: 'image/png', body: artwork }));
  await page.route('**/api/**', route => {
    const pathname = new URL(route.request().url()).pathname;
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (pathname === '/api/accreditations/active') return json({ id: 'metacrilatos', renderer: 'metacrilatos-v1', config: { version: 1 } });
    if (pathname === '/api/membership/me/accreditation') {
      state.credentials++;
      return json({ circleLevel: state.level, registrationNumber: 23, name: 'Daniel Rivas', createdAt: '2020-01-01T23:30:00Z',
        visibleId: '11111111-2222-4333-8444-555555555555', qrDataUrl });
    }
    if (pathname === '/api/me') return json({ id: 7, firstName: 'Daniel', memberCode: 'CRX-000007', circleLevel: state.level });
    if (pathname === '/api/membership/me/stats') return json({ circleLevel: state.level,
      pedidosRealizados: 18, articulosAdquiridos: 23, productosDiferentes: 7 });
    if (pathname.includes('circle-upgrade')) return json({ circleLevel: state.level, hasPending: false, canRequest: false });
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
    await expect(page.locator('[data-meta-history]')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('.crx-qr img')).toHaveJSProperty('complete', true);
    if (clock) await page.clock.runFor(96);
  };
  await state.open(5);
  return state;
}

function geometry() {
  const rect = selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.x, y: r.y + scrollY, width: r.width, height: r.height, bottom: r.bottom + scrollY };
  };
  return {
    viewport: { width: innerWidth, height: innerHeight },
    document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    header: rect('body > header'), title: rect('.store-heading'), nav: rect('.profile-tabs'),
    stage: rect('.crx-stage'), button: rect('[data-crx-flip]'), memberTitle: rect('.metacrilatos-member__title'),
    back: rect('[data-profile-section="accreditation"] .profile-back-link'),
    section: rect('[data-profile-section="accreditation"]'), footer: rect('body > .footer p'),
    footerPosition: getComputedStyle(document.querySelector('body > .footer')).position,
  };
}

const pose = page => page.locator('.crx-slab').evaluate(el => {
  const [, x, y] = el.style.transform.match(/rotateX\(([-\d.e]+)deg\) rotateY\(([-\d.e]+)deg\)/);
  return { x: Number(x), y: Number(y) };
});

test('every roman marker keeps its own approved fill regardless of current circle', async ({ page }) => {
  const state = await openProfile(page);
  const expected = ['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(135, 143, 148)', 'rgb(255, 255, 255)', 'rgb(154, 28, 54)'];
  for (let level = 1; level <= 5; level++) {
    if (state.level !== level) await state.open(level);
    const markers = page.locator('[data-meta-circle-marker]');
    const colors = await markers.evaluateAll(elements => elements.map(el => getComputedStyle(el).backgroundColor));
    expect(colors).toEqual(expected);
    await expect(page.locator(`[data-meta-circle-marker="${level}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('[data-meta-circle-marker][aria-current="true"]')).toHaveCount(1);
    const dimensions = await markers.evaluateAll(elements => elements.map(el => el.getBoundingClientRect().width));
    expect(dimensions[level - 1]).toBeGreaterThan(Math.min(...dimensions));
    await expect(page.locator('[data-meta-circle-marker] button, [data-meta-circle-marker] a')).toHaveCount(0);
  }
  expect(state.errors).toEqual([]);
});

test('desktop fitting grows proportionally, reserves its space and resizes without remounting or resetting a held gesture', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'Desktop layout and Chromium pointer/QR integration.');
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  const state = await openProfile(page, { clock: true });
  const initial = await page.evaluate(geometry);
  expect(initial.button.height).toBeGreaterThan(44);
  await page.evaluate(() => { window.fitTestSlab = document.querySelector('.crx-slab'); });
  const box = await page.locator('.crx-stage').boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const held = await pose(page);
  const layouts = [];
  for (const size of [{ width: 2560, height: 1440 }, { width: 1366, height: 768 }, { width: 1366, height: 480 }]) {
    await page.setViewportSize(size);
    await page.clock.runFor(96);
    const current = await page.evaluate(geometry);
    layouts.push(current);
    expect(current.document.width).toBeLessThanOrEqual(size.width);
    expect(current.footer.x).toBeCloseTo(10, 0);
    expect(['fixed', 'absolute']).not.toContain(current.footerPosition);
    expect(current.footer.y).toBeGreaterThan(current.section.bottom);
    expect(current.back.x + current.back.width / 2).toBeCloseTo(current.section.x + current.section.width / 2, 0);
    expect(current.back.height).toBeGreaterThanOrEqual(44);
    expect(await pose(page)).toEqual(held);
    expect(await page.evaluate(() => document.querySelector('.crx-slab') === window.fitTestSlab)).toBe(true);
    expect(current.header.height).toBe(initial.header.height);
    expect(current.title.y).toBe(initial.title.y);
    expect(current.title.height).toBe(initial.title.height);
    expect(current.nav.y).toBe(initial.nav.y);
    expect(current.nav.height).toBe(initial.nav.height);
  }
  const large = layouts[0];
  const scale = large.button.height / initial.button.height;
  expect(scale).toBeGreaterThan(1.3);
  expect(large.stage.height / initial.stage.height).toBeCloseTo(scale, 2);
  expect(large.memberTitle.height / initial.memberTitle.height).toBeCloseTo(scale, 2);
  // The new return row spans both columns. Preserve the existing content
  // scale; if that row requires extra height the footer follows in flow.
  expect(large.document.height - large.footer.bottom).toBeCloseTo(10, 0);
  expect(layouts[2].document.height).toBeGreaterThan(layouts[2].viewport.height);

  await page.clock.runFor(8500);
  expect(await pose(page)).toEqual(held);
  await page.mouse.up();
  await page.setViewportSize({ width: 2560, height: 1440 });
  await page.clock.runFor(6900);
  expect(await pose(page)).toEqual(held);
  await page.clock.runFor(180);
  expect((await pose(page)).y).toBeGreaterThan(held.y);
  expect(state.credentials).toBe(1);

  // Native mouse hit testing at the enlarged visible coordinates and the
  // renderer's unchanged screen-pixel drag sensitivity.
  const enlarged = await page.locator('.crx-stage').boundingBox();
  const center = { x: enlarged.x + enlarged.width / 2, y: enlarged.y + enlarged.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  const beforeDrag = await pose(page);
  await page.mouse.move(center.x + 60, center.y + 20, { steps: 4 });
  const dragged = await pose(page);
  expect(dragged.y - beforeDrag.y).toBeCloseTo(39, 3);
  expect(dragged.x - beforeDrag.x).toBeCloseTo(-6, 3);
  await page.mouse.up();
  if (Math.cos(dragged.y * Math.PI / 180) < 0) {
    await page.locator('[data-crx-flip]').click();
    await page.clock.runFor(700);
  }
  await page.locator('[data-crx-flip]').click();
  await page.clock.runFor(700);
  await expect(page.locator('.crx-back')).toHaveAttribute('aria-hidden', 'false');
  await page.addScriptTag({ url: '/assets/qr-reader.js' });
  const qr = await page.locator('.crx-qr').screenshot();
  const decoded = await page.evaluate(async source => {
    const reader = await window.CRONOX_QR_READER.createReader();
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return reader.decodeFromCanvas(canvas);
  }, `data:image/png;base64,${qr.toString('base64')}`);
  expect(decoded).toBe(token);
  await page.clock.runFor(6400);
  await page.evaluate(() => {
    const angle = () => Number(/rotateY\(([-\d.e]+)deg\)/.exec(document.querySelector('.crx-slab').style.transform)[1]);
    window.fitTestTurn = { start: angle(), end: angle(), clearance: Infinity, active: true };
    const sample = () => {
      const turn = window.fitTestTurn;
      if (!turn.active) return;
      const bottom = Math.max(...[...document.querySelectorAll('.crx-face, .crx-rim-panel')].map(el => el.getBoundingClientRect().bottom));
      turn.clearance = Math.min(turn.clearance, document.querySelector('[data-crx-flip]').getBoundingClientRect().top - bottom);
      turn.end = angle();
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.clock.runFor(17400);
  const turn = await page.evaluate(() => { window.fitTestTurn.active = false; return window.fitTestTurn; });
  expect(turn.end - turn.start).toBeGreaterThanOrEqual(360);
  expect(turn.clearance).toBeGreaterThan(15);
  expect(state.errors).toEqual([]);
});
