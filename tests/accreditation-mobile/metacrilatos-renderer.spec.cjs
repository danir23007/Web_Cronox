const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const QRCode = require('../../cronox-backend/node_modules/qrcode');
const sharp = require('../../cronox-backend/node_modules/sharp');
const { prepareZXingModule, readBarcodes } = require('zxing-wasm/reader');

const token = 'CRX:1:JrXl5aPPqWpvx2Ud65_GoCrWbGXvlun9';
const longToken = `CRX:1:${crypto.createHash('sha256').update('existing persistent credential with 64 hex characters').digest('hex')}`;
const baseData = {
  name: 'Daniel Rivas Cruz', createdAt: '2025-11-17T23:30:00.000Z',
  visibleId: '76ddc205-e68d-4f01-b2d1-dd6ac050f481',
  registrationNumber: 23,
};
let qrDataUrl;
let longQrDataUrl;
test.beforeAll(async () => {
  const options = {
    width: 592, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#49212c', light: '#e9d8c4' },
  };
  qrDataUrl = await QRCode.toDataURL(token, options);
  longQrDataUrl = await QRCode.toDataURL(longToken, options);
});

async function harness(page) {
  await page.route('**/metacrilatos-renderer-test', route => route.fulfill({
    contentType: 'text/html', body: `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#080809}</style><link rel="stylesheet" href="/assets/metacrilatos.css?v=2"><div id="root"></div><script src="/assets/metacrilatos.js"></script><script src="/assets/qr-reader.js"></script>`,
  }));
  await page.goto('/metacrilatos-renderer-test');
  await page.evaluate(() => {
    window.rendererObservers = [];
    const Original = window.ResizeObserver;
    window.ResizeObserver = class extends Original {
      constructor(callback) { super(callback); window.rendererObservers.push(this); this.disconnected = false; }
      disconnect() { this.disconnected = true; super.disconnect(); }
    };
  });
}

async function render(page, level, extra = {}) {
  await page.evaluate(async data => {
    if (window.renderer) await window.renderer.update(data);
    else { window.renderer = window.CRONOX_METACRILATOS.mount(document.getElementById('root'), data); await window.renderer.ready; }
  }, { ...baseData, circleLevel: level, qrDataUrl, ...extra });
}

async function decodeScreenshot(page, buffer) {
  return page.evaluate(async source => {
    window.testQrReader ||= await window.CRONOX_QR_READER.createReader();
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return window.testQrReader.decodeFromCanvas(canvas);
  }, `data:image/png;base64,${buffer.toString('base64')}`);
}

test('all approved hashes, 68 edge panels, exact circle colors/contours, readable real QR at rendered size', async ({ page }, testInfo) => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../metacrilatos-codex/MANIFEST.json'), 'utf8'));
  await harness(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const colors = ['rgb(216, 218, 221)', 'rgb(216, 218, 221)', 'rgb(211, 214, 215)', 'rgb(63, 69, 72)', 'rgb(212, 182, 155)'];
  for (const entry of manifest.disenos) {
    const reference = fs.readFileSync(path.resolve(__dirname, '../../metacrilatos-codex', entry.archivo));
    expect(reference.length).toBe(entry.bytes);
    expect(crypto.createHash('sha256').update(reference).digest('hex')).toBe(entry.sha256);
    await render(page, entry.circulo);
    await expect(page.locator('.crx-rim-panel')).toHaveCount(68);
    await expect(page.locator('.crx-ring')).toHaveCount(entry.circulo);
    await expect(page.locator('.crx-roman')).toHaveText(['I', 'II', 'III', 'IV', 'V'][entry.circulo-1]);
    const styles = await page.evaluate(() => {
      const card = document.querySelector('.crx-front .crx-card');
      const label = document.querySelector('.crx-front .crx-label');
      return {
        card: getComputedStyle(card).boxShadow,
        inner: getComputedStyle(card, '::before').borderTopWidth,
        roman: getComputedStyle(document.querySelector('.crx-roman')).color,
        logo: document.querySelector('[data-crx-circle-ink]').getAttribute('flood-color'),
        label: getComputedStyle(label).color,
        symbol: document.querySelector('[data-crx-label-ink]').getAttribute('flood-color'),
        width: document.querySelector('.crx-slab').offsetWidth,
        height: document.querySelector('.crx-slab').offsetHeight,
        hiddenDemo: document.body.textContent.includes('CONCEPTO') || document.body.textContent.includes('CRX-000001'),
      };
    });
    expect(styles.roman).toBe(colors[entry.circulo-1]);
    expect(styles.inner).toBe('1px');
    expect(styles.card.includes('inset')).toBe(entry.circulo === 4);
    expect(styles.hiddenDemo).toBe(false);
    expect([250, 264]).toContain(styles.width);
    expect([400, 414]).toContain(styles.height);
    await expect(page.locator('[data-crx-name]')).toHaveText('Daniel Rivas');
    await expect(page.locator('[data-crx-date]')).toHaveText('18/11/2025');
    fs.mkdirSync(path.resolve(__dirname, '../../output/playwright'), { recursive: true });
    await page.locator('.crx-stage').screenshot({ path: path.resolve(__dirname, `../../output/playwright/metacrilatos-${entry.circulo}-${testInfo.project.name}-front.png`) });
    await page.locator('[data-crx-flip]').click();
    await expect(page.locator('.crx-back')).toHaveAttribute('aria-hidden', 'false');
    const qr = await page.locator('.crx-qr').screenshot();
    await testInfo.attach(`circle-${entry.circulo}-qr`, { body: qr, contentType: 'image/png' });
    fs.writeFileSync(path.resolve(__dirname, `../../output/playwright/metacrilatos-${entry.circulo}-${testInfo.project.name}-qr.png`), qr);
    let decoded;
    try { decoded = await decodeScreenshot(page, qr); } catch (error) { decoded = error.message; }
    expect.soft(decoded).toBe(token);
    await page.locator('.crx-stage').screenshot({ path: path.resolve(__dirname, `../../output/playwright/metacrilatos-${entry.circulo}-${testInfo.project.name}-back.png`) });
    await testInfo.attach(`circle-${entry.circulo}-reverse-${testInfo.project.name}`, { body: await page.locator('.crx-stage').screenshot(), contentType: 'image/png' });
    const fullId = await page.locator('[data-crx-id]').evaluate(element => ({ text: element.textContent, width: element.scrollWidth, available: element.clientWidth }));
    expect(fullId.text).toBe(String(baseData.registrationNumber));
    expect(fullId.width).toBeLessThanOrEqual(fullId.available + 1);
    await render(page, entry.circulo, { qrDataUrl: longQrDataUrl });
    await page.locator('[data-crx-flip]').click();
    const longQr = await page.locator('.crx-qr').screenshot();
    fs.writeFileSync(path.resolve(__dirname, `../../output/playwright/metacrilatos-${entry.circulo}-${testInfo.project.name}-long-qr.png`), longQr);
    expect(await decodeScreenshot(page, longQr)).toBe(longToken);
  }
});

test('name/date validation, update isolation, multiple instances, unknown circle and cleanup', async ({ page }) => {
  await harness(page);
  await render(page, 3);
  for (const [name, expected] of [
    ['Daniel', 'Daniel'], ['  Daniel   Rivas  Cruz ', 'Daniel Rivas'], [null, ''], [undefined, ''], ['', ''], ['   ', ''],
    ['<img onerror=alert(1)> Test Extra', '<img onerror=alert(1)>'],
    ['Alejandramaríadelosángeles Maximilianofranciscodelacruz Apellido', 'Alejandramaríadelosángeles Maximilianofranciscodelacruz'],
  ]) {
    await render(page, 3, { name });
    await expect(page.locator('[data-crx-name]')).toHaveText(expected);
    await expect(page.locator('[data-crx-name] img')).toHaveCount(0);
    expect(await page.locator('[data-crx-name]').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(page.locator('[data-crx-date]')).toHaveText('18/11/2025');
    await expect(page.locator('.crx-ring')).toHaveCount(3);
  }
  for (const createdAt of [null, undefined, '', 'bad', '2025-02-30T12:00:00Z']) {
    await render(page, 2, { createdAt });
    await expect(page.locator('[data-crx-date]')).toBeEmpty();
  }
  await page.evaluate(async data => {
    const second = document.createElement('div'); second.id = 'second'; document.body.append(second);
    window.secondRenderer = window.CRONOX_METACRILATOS.mount(second, data); await window.secondRenderer.ready;
  }, { ...baseData, circleLevel: 5, qrDataUrl });
  const ids = await page.locator('filter').evaluateAll(elements => elements.map(element => element.id));
  expect(new Set(ids).size).toBe(4);
  await expect(page.locator('#root [data-crx-auto]')).toHaveCount(0);
  await page.evaluate(() => window.renderer.destroy());
  expect(await page.locator('#root').textContent()).toBe('');
  expect(await page.evaluate(() => window.rendererObservers.slice(0, -1).every(observer => observer.disconnected))).toBe(true);
  await expect(page.locator('#second .crx-ring')).toHaveCount(5);
  await page.evaluate(async () => { await window.secondRenderer.update({ circleLevel: 0 }); });
  await expect(page.locator('#second .crx-slab')).toHaveCount(0);
  await expect(page.locator('#second')).toContainText('círculo sin asignar');
  expect(await page.evaluate(() => window.rendererObservers.every(observer => observer.disconnected))).toBe(true);
});

test('front/back geometry and surface styles agree with each approved reference', async ({ page, context }) => {
  await harness(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const source = await context.newPage();
  await source.emulateMedia({ reducedMotion: 'reduce' });
  async function geometry(target) {
    return target.evaluate(() => {
      const selectors = ['.crx-slab', '.crx-front', '.crx-back', '.crx-front .crx-label', '.crx-front .crx-card', '.crx-card-back', '.crx-long-logo', '.crx-long-logo img', '.crx-emblem', '.crx-roman', '.crx-eye-logo', '.crx-eye-logo img', '.crx-qr'];
      return selectors.map(selector => {
        const element = document.querySelector(selector), style = getComputedStyle(element);
        const fields = ['width', 'height', 'top', 'left', 'bottom', 'right', 'border', 'borderRadius', 'boxShadow', 'backgroundImage', 'backgroundColor', 'fontFamily', 'fontSize', 'color', 'overflow', 'zIndex'];
        return { selector, properties: Object.fromEntries(fields.map(field => [field, style[field]])) };
      });
    });
  }
  for (let level = 1; level <= 5; level++) {
    const html = fs.readFileSync(path.resolve(__dirname, `../../metacrilatos-codex/disenos/circulo-${level}.html`), 'utf8');
    await source.setContent(`<style>body{margin:0}</style>${html}`);
    await source.locator('.crx-rim-panel').first().waitFor();
    await render(page, level);
    expect(await geometry(page)).toEqual(await geometry(source));
    await source.locator('[data-crx-flip]').click();
    await page.locator('[data-crx-flip]').click();
    expect(await geometry(page)).toEqual(await geometry(source));
    expect(await page.locator('.crx-slab').getAttribute('style')).toContain('rotateY(-180deg)');
  }
  await source.close();
});

test('failed assets reject ready and can recover; destroying pending images settles and disconnects', async ({ page }) => {
  await harness(page);
  let attempts = 0;
  await page.route('**/metacrilatos/eye.png', route => ++attempts === 1 ? route.abort('failed') : route.continue());
  const failure = await page.evaluate(async data => {
    window.renderer = window.CRONOX_METACRILATOS.mount(document.getElementById('root'), data);
    try { await window.renderer.ready; return null; } catch (error) { return error.message; }
  }, { ...baseData, circleLevel: 1, qrDataUrl });
  expect(failure).toContain('imagen');
  await render(page, 1);
  expect(await page.locator('[data-crx-asset="eye.png"]').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await page.unroute('**/metacrilatos/eye.png');
  await harness(page);
  let pending;
  await page.route('**/metacrilatos/eye.png', route => { pending = route; });
  await page.evaluate(data => { window.renderer = window.CRONOX_METACRILATOS.mount(document.getElementById('root'), data); window.pendingReady = window.renderer.ready; }, { ...baseData, circleLevel: 2, qrDataUrl });
  await expect.poll(() => !!pending).toBe(true);
  await page.evaluate(async () => { window.renderer.destroy(); await window.pendingReady; });
  await pending.abort('failed');
  expect(await page.locator('#root').textContent()).toBe('');
  expect(await page.evaluate(() => window.rendererObservers.every(observer => observer.disconnected))).toBe(true);
});

test('stylesheet loading failure resets for retry and missing resource is bounded', async ({ page }) => {
  await harness(page);
  await page.locator('link[rel="stylesheet"]').evaluate(element => element.remove());
  let attempts = 0;
  await page.route(/\/metacrilatos\.css(?:\?.*)?$/, route => ++attempts === 1 ? route.abort('failed') : route.continue());
  const failure = await page.evaluate(async data => {
    window.renderer = window.CRONOX_METACRILATOS.mount(document.getElementById('root'), data);
    try { await window.renderer.ready; return null; } catch (error) { return error.message; }
  }, { ...baseData, circleLevel: 4, qrDataUrl });
  expect(failure).toContain('METACRILATOS');
  await render(page, 4);
  await expect(page.locator('.crx-rim-panel')).toHaveCount(68);
  await harness(page);
  await page.clock.install();
  let pending;
  await page.route('**/metacrilatos/eye.png', route => { pending = route; });
  await page.evaluate(data => { window.renderer = window.CRONOX_METACRILATOS.mount(document.getElementById('root'), data); window.pendingFailure = window.renderer.ready.then(() => '', error => error.message); }, { ...baseData, circleLevel: 4, qrDataUrl });
  await expect.poll(() => !!pending).toBe(true);
  await page.clock.fastForward(15001);
  expect(await page.evaluate(() => window.pendingFailure)).toContain('imagen');
  await page.evaluate(() => window.renderer.destroy());
  await pending.abort('failed');
});

test('narrow 240px host scales proportionally and keeps the longest personal QR readable', async ({ page }) => {
  await harness(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#root').evaluate(element => { element.style.width = '240px'; });
  for (let level = 1; level <= 5; level++) {
    await render(page, level, { qrDataUrl: longQrDataUrl });
    expect(await page.locator('#root').evaluate(element => Number(element.style.getPropertyValue('--crx-scale')))).toBeLessThan(1);
    await page.locator('[data-crx-flip]').click();
    expect(await decodeScreenshot(page, await page.locator('.crx-qr').screenshot())).toBe(longToken);
  }
});

test('both faces exclude the opposite artwork and the displayed QR is never mirrored', async ({ page }) => {
  await harness(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
  for (let level = 1; level <= 5; level++) {
    await render(page, level);
    for (const face of ['front', 'back']) {
      if (face === 'back') await page.locator('[data-crx-flip]').click();
      const opposite = page.locator(`.crx-${face === 'front' ? 'back' : 'front'}`);
      const before = await page.locator('.crx-stage').screenshot();
      // Compare rendered pixels with the opposite face entirely removed. This
      // catches compositors that report backface:hidden but still paint it.
      await opposite.evaluate(element => { element.style.display = 'none'; });
      const withoutOpposite = await page.locator('.crx-stage').screenshot();
      const beforePixels = await sharp(before).raw().toBuffer();
      expect(beforePixels.equals(await sharp(withoutOpposite).raw().toBuffer())).toBe(true);
      await opposite.evaluate(element => { element.style.display = ''; });
      await expect(page.locator('.crx-rim-panel')).toHaveCount(68);
      if (face === 'back') {
        const { data, info } = await sharp(await page.locator('.crx-qr').screenshot()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const codes = await readBarcodes({ data: new Uint8ClampedArray(data), width: info.width, height: info.height }, { formats: ['QRCode'], tryHarder: true });
        expect(codes).toHaveLength(1);
        expect(codes[0].text).toBe(token);
        expect(codes[0].isMirrored).toBe(false);
      }
    }
  }
});
