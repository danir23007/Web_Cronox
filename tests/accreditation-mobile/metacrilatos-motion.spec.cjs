const { test, expect } = require('@playwright/test');
const { readFileSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const QRCode = require('../../cronox-backend/node_modules/qrcode');

// Real browser/production scripts, with isolated account data and a simulated
// clock. No account, active-design setting, or event is changed by these tests.
const artwork = readFileSync(path.resolve(__dirname, '../../cronox-front/assets/logo_banner.png'));
const previewPath = '/api/admin/accreditations/metacrilatos/preview';
const previewHtml = readFileSync(path.resolve(__dirname, '../../cronox-front/metacrilatos-preview.html'), 'utf8');
const design = { id: 'metacrilatos', renderer: 'metacrilatos-v1', config: { version: 1 } };
let qrDataUrl;
test.beforeAll(async () => {
  qrDataUrl = await QRCode.toDataURL('CRX:1:0123456789abcdef0123456789abcdef', {
    width: 592, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#49212c', light: '#e9d8c4' },
  });
});

async function setup(page, target, simulatedClock = true) {
  const state = { level: 1, errors: [], writes: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.route('https://**/*', route => route.fulfill({ contentType: 'image/png', body: artwork }));
  await page.route('**/api/**', route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (request.method() !== 'GET') state.writes.push(pathname);
    if (pathname === previewPath) return route.fulfill({ contentType: 'text/html', body: previewHtml });
    if (pathname === `${previewPath}-data`) return json({ ...design, sampleQr: qrDataUrl });
    if (pathname === '/api/accreditations/active') return json(design);
    if (pathname === '/api/membership/me/accreditation') return json({ circleLevel: state.level,
      name: 'Daniel Rivas', createdAt: '2020-01-01T23:30:00Z',
      visibleId: '11111111-2222-4333-8444-555555555555', registrationNumber: 1, memberCode: 'CRX-000050', qrDataUrl });
    if (pathname === '/api/me') return json({ id: 7, firstName: 'Daniel', memberCode: 'CRX-000007', circleLevel: state.level });
    if (pathname === '/api/membership/me/qr') return route.fulfill({ contentType: 'image/png', body: Buffer.from(qrDataUrl.split(',')[1], 'base64') });
    if (pathname === '/api/membership/me/stats') return json({ circleLevel: state.level, createdAt: '2020-01-01T23:30:00Z' });
    if (pathname.includes('circle-upgrade')) return json({ circleLevel: state.level, hasPending: false, canRequest: false });
    if (pathname === '/api/me/address') return json(null);
    if (pathname === '/api/cart') return json({ items: [], itemsCount: 0, subtotal: 0 });
    if (pathname === '/api/me/orders' || pathname === '/api/favorites') return json([]);
    if (pathname === '/api/products') return json({ items: [] });
    return json({});
  });
  if (simulatedClock) {
    const epoch = new Date('2030-01-01T12:00:00Z');
    await page.clock.install({ time: epoch });
    await page.clock.pauseAt(epoch);
  }
  await page.goto(target === 'profile' ? '/profile.html' : previewPath);
  if (target === 'profile') {
    await page.locator('.cronox-consent [data-consent-action="reject"]').click();
    await page.locator('[data-profile-tab="accreditation"]').click();
  }
  await expect(page.locator('.crx-metacrilatos')).toBeVisible();
  await expect(page.locator('.crx-qr img')).toHaveJSProperty('complete', true);
  if (simulatedClock) await page.clock.runFor(64);
  state.changeCircle = async level => {
    state.level = level;
    if (target === 'profile') {
      await page.locator('[data-profile-tab="orders"]').click();
      await expect(page.locator('.crx-metacrilatos')).toHaveCount(0);
      await page.locator('[data-profile-tab="accreditation"]').click();
    } else {
      await page.getByRole('combobox', { name: 'Círculo de muestra' }).selectOption(String(level));
    }
    await expect(page.locator('.crx-metacrilatos')).toHaveAttribute('data-crx-level', String(level));
    await page.clock.runFor(64);
  };
  return state;
}

const angles = page => page.locator('.crx-slab').evaluate(element => {
  const [, x, y] = element.style.transform.match(/rotateX\(([-\d.e]+)deg\) rotateY\(([-\d.e]+)deg\)/);
  return { x: Number(x), y: Number(y) };
});
async function expectSpinning(page) {
  await page.locator('.crx-stage').scrollIntoViewIfNeeded();
  await page.clock.runFor(64); // Deliver the viewport visibility update after scrolling.
  const before = await angles(page);
  await page.clock.runFor(160);
  const after = await angles(page);
  expect(after.y - before.y).toBeGreaterThan(2.5);
  expect(after.y - before.y).toBeLessThan(4);
  expect(after.x).toBe(before.x);
}
async function expectLabelMatchesFace(page) {
  const { y } = await angles(page);
  const front = Math.cos(y * Math.PI / 180) >= 0;
  await expect(page.locator('[data-crx-flip]')).toHaveText(front ? 'Ver reverso' : 'Ver anverso');
  await expect(page.locator('.crx-front')).toHaveAttribute('aria-hidden', String(!front));
  await expect(page.locator('.crx-back')).toHaveAttribute('aria-hidden', String(front));
}
async function reduceMotion(page) {
  await page.evaluate(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    window.reducedMotionApplied = query.matches ? Promise.resolve() : new Promise(resolve => {
      query.addEventListener('change', resolve, { once: true });
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.reducedMotionApplied);
}

for (const target of ['profile', 'preview']) {
  test(`${target}: all five circles start automatically, retain one centered control and resume five seconds after face placement`, async ({ page }) => {
    test.setTimeout(90000); // WebKit renders every simulated animation frame for all five cards.
    const state = await setup(page, target);
    for (let level = 1; level <= 5; level++) {
      if (level > 1) await state.changeCircle(level);
      await expect(page.locator('.crx-actions button')).toHaveCount(1);
      await expect(page.locator('[data-crx-auto]')).toHaveCount(0);
      expect(await page.locator('.crx-actions').evaluate(element => getComputedStyle(element).justifyContent)).toBe('center');
      await expectSpinning(page);
      await page.clock.runFor(6000);
      await expectLabelMatchesFace(page); // Label follows the automatic turn.
      const button = page.locator('[data-crx-flip]');
      const requestedFront = (await button.textContent()) === 'Ver anverso';
      await button.focus();
      await button.press(level % 2 ? 'Enter' : 'Space');
      const started = await angles(page);
      await page.clock.runFor(160);
      const midway = await angles(page);
      expect(Math.abs(midway.y - started.y)).toBeGreaterThan(1);
      await page.clock.runFor(540);
      const resting = await angles(page);
      expect(resting.x).toBeCloseTo(0, 8);
      expect(Math.abs(Math.cos(resting.y * Math.PI / 180))).toBeCloseTo(1, 8);
      await expect(button).toHaveText(requestedFront ? 'Ver reverso' : 'Ver anverso');
      await page.clock.runFor(4850); // 4.9 s after the 650 ms face transition completes.
      expect(await angles(page)).toEqual(resting);
      await page.clock.runFor(180);
      const resumed = await angles(page);
      expect(resumed.y).toBeGreaterThan(resting.y);
      expect(resumed.y - resting.y).toBeLessThan(3);
    }
    if (target === 'profile') await expect(page.getByRole('button', { name: 'Volver a la tienda', exact: true })).toBeVisible();
    await reduceMotion(page); // Wait for the browser's asynchronous media-query event.
    const reduced = await angles(page);
    await page.clock.runFor(8000);
    expect(await angles(page)).toEqual(reduced);
    await page.locator('[data-crx-flip]').click();
    const requested = await angles(page);
    expect(Math.abs(Math.cos(requested.y * Math.PI / 180))).toBeCloseTo(1, 8);
    await page.clock.runFor(8000);
    expect(await angles(page)).toEqual(requested);
    expect(state.errors).toEqual([]);
    expect(state.writes).toEqual([]);
  });

  test(`${target}: touch and pen on a desktop-width hybrid cancel the button pause and release without an orientation jump`, async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 1000 }); // Input type, not the responsive breakpoint, controls release.
    const state = await setup(page, target);
    const stage = page.locator('.crx-stage');
    const button = page.locator('[data-crx-flip]');
    let pointerId = 30;
    for (const pointerType of ['touch', 'pen']) {
      for (const releaseType of ['pointerup', 'pointercancel']) {
        await button.click();
        await page.clock.runFor(700);
        await stage.scrollIntoViewIfNeeded();
        const box = await stage.boundingBox();
        const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const event = { pointerType, pointerId: pointerId++, isPrimary: true,
          button: 0, buttons: 1, clientX: point.x, clientY: point.y };
        const beforeGesture = await angles(page);
        // Synthetic pointer events cover the shared state machine, in addition
        // to the browser-generated Chromium touch gesture checked below.
        await stage.dispatchEvent('pointerdown', event);
        expect(await angles(page)).toEqual(beforeGesture);
        await page.clock.runFor(5500); // The obsolete button deadline expires while held.
        expect(await angles(page)).toEqual(beforeGesture);
        await stage.dispatchEvent('pointermove', { ...event,
          clientX: point.x + 40, clientY: point.y + 10 });
        const moved = await angles(page);
        expect(moved.y - beforeGesture.y).toBeCloseTo(26, 6);
        expect(moved.x - beforeGesture.x).toBeCloseTo(-3, 6);
        await button.evaluate(element => element.click());
        await page.clock.runFor(700);
        expect(await angles(page)).toEqual(moved);
        await stage.dispatchEvent(releaseType, { ...event, buttons: 0 });
        expect(await angles(page)).toEqual(moved);
        await expectSpinning(page);
      }
    }
    expect(state.errors).toEqual([]);
    expect(state.writes).toEqual([]);
  });
}

test('mouse hold, hover, rapid activations, release and capture loss coordinate a single five-second deadline', async ({ page }) => {
  const state = await setup(page, 'profile');
  const stage = page.locator('.crx-stage');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  let center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(center.x, center.y);
  await expectSpinning(page); // Hover does not pause.
  const button = page.locator('[data-crx-flip]');
  await button.click();
  await page.clock.runFor(170);
  const turning = await angles(page);
  await stage.scrollIntoViewIfNeeded();
  const afterButton = await stage.boundingBox();
  center = { x: afterButton.x + afterButton.width / 2, y: afterButton.y + afterButton.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  expect(await angles(page)).toEqual(turning); // Interrupt without a jump.
  await page.clock.runFor(8500);
  expect(await angles(page)).toEqual(turning);
  await page.mouse.move(center.x + 60, center.y + 20, { steps: 4 });
  const dragged = await angles(page);
  expect(dragged.y - turning.y).toBeCloseTo(39, 3);
  expect(dragged.x - turning.x).toBeCloseTo(-6, 3);
  await page.clock.runFor(8500);
  expect(await angles(page)).toEqual(dragged);
  await button.evaluate(element => element.click()); // An active gesture owns the orientation.
  await page.clock.runFor(700);
  expect(await angles(page)).toEqual(dragged);
  await page.mouse.up();
  await page.clock.runFor(4000);
  await page.mouse.move(center.x - 10, center.y - 10);
  await page.clock.runFor(900);
  expect(await angles(page)).toEqual(dragged); // Hover did not postpone release deadline.
  await page.clock.runFor(180);
  expect((await angles(page)).y).toBeGreaterThan(dragged.y);

  for (let activation = 0; activation < 4; activation++) {
    await button.click();
    await page.clock.runFor(100);
  }
  await page.clock.runFor(600);
  const settled = await angles(page);
  await page.clock.runFor(4850);
  expect(await angles(page)).toEqual(settled);
  await button.click(); // New activation resets the preceding deadline.
  await page.clock.runFor(700);
  const reset = await angles(page);
  await page.clock.runFor(4850);
  expect(await angles(page)).toEqual(reset);
  await page.clock.runFor(180);
  expect((await angles(page)).y).toBeGreaterThan(reset.y);

  await stage.scrollIntoViewIfNeeded();
  const afterRepeatedButtons = await stage.boundingBox();
  center = { x: afterRepeatedButtons.x + afterRepeatedButtons.width / 2, y: afterRepeatedButtons.y + afterRepeatedButtons.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 1, center.y); // Commit the browser's pending capture first.
  const held = await angles(page);
  await stage.evaluate(element => {
    if (element.hasPointerCapture(1)) element.releasePointerCapture(1);
  });
  await page.mouse.move(center.x + 2, center.y); // Browser delivers lostpointercapture.
  await page.clock.runFor(4900);
  expect(await angles(page)).toEqual(held);
  await page.clock.runFor(180);
  expect((await angles(page)).y).toBeGreaterThan(held.y);
  await page.mouse.up();
  expect(state.errors).toEqual([]);
});

test('desktop browser with its real clock automatically resumes five seconds after face placement', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real-clock smoke check complements deterministic cross-browser timing tests.');
  const state = await setup(page, 'preview', false);
  const before = await angles(page);
  await expect.poll(async () => (await angles(page)).y).toBeGreaterThan(before.y + 2);
  const button = page.locator('[data-crx-flip]');
  await button.click();
  await page.waitForTimeout(800);
  const resting = await angles(page);
  await page.waitForTimeout(4700);
  expect(await angles(page)).toEqual(resting);
  await expect.poll(async () => (await angles(page)).y, { timeout: 2000 }).toBeGreaterThan(resting.y + 1);
  await reduceMotion(page);
  await button.click();
  const directory = path.resolve(__dirname, '../../output/playwright');
  mkdirSync(directory, { recursive: true });
  await page.locator('.crx-display').screenshot({ path: path.join(directory, 'metacrilatos-single-control-preview.png') });
  expect(state.errors).toEqual([]);
});

test('browser-generated touch drag and cancellation resume immediately from the released orientation; only the button pauses for five seconds', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Touch drag/cancel uses the Chromium input protocol; no physical device is involved.');
  const state = await setup(page, 'profile');
  const stage = page.locator('.crx-stage');
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await context.newCDPSession(page);
  await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  const held = await angles(page);
  await page.clock.runFor(8100);
  expect(await angles(page)).toEqual(held);
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + 40, y: point.y }] });
  const moved = await angles(page);
  expect(moved.y).toBeGreaterThan(held.y);
  await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await angles(page)).toEqual(moved); // Release/cancel never snaps or restores a face.
  await page.clock.runFor(160);
  const afterCancel = await angles(page);
  expect(afterCancel.y - moved.y).toBeGreaterThan(2.5);
  expect(afterCancel.y - moved.y).toBeLessThan(4);
  expect(afterCancel.x).toBe(moved.x);
  const button = page.locator('[data-crx-flip]');
  await button.scrollIntoViewIfNeeded();
  const buttonBox = await button.boundingBox();
  const tap = { x: buttonBox.x + buttonBox.width / 2, y: buttonBox.y + buttonBox.height / 2 };
  const expectedLabel = (await button.textContent()) === 'Ver reverso' ? 'Ver anverso' : 'Ver reverso';
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [tap] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.clock.runFor(700);
  await expect(button).toHaveText(expectedLabel);
  const afterTap = await angles(page);
  await page.clock.runFor(4850);
  expect(await angles(page)).toEqual(afterTap);
  await page.clock.runFor(180);
  expect((await angles(page)).y).toBeGreaterThan(afterTap.y);
  await button.click();
  await page.clock.runFor(100);
  await state.changeCircle(5); // Closes with both a turn and a resume deadline pending.
  await expectSpinning(page);
  await page.clock.runFor(7200);
  await expectSpinning(page); // Obsolete deadline cannot interfere or double the speed.
  await session.detach();
  expect(state.errors).toEqual([]);
});
