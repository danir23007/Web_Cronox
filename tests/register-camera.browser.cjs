'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('@playwright/test');
const backendRequire = require('node:module').createRequire(path.resolve(__dirname, '../cronox-backend/package.json'));
const { JSDOM } = backendRequire('jsdom');
const bwip = backendRequire('bwip-js');
const front = path.resolve(__dirname, '../cronox-front');
const out = path.resolve(__dirname, '../output/playwright/register-camera');

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const parsed = new JSDOM(fs.readFileSync(path.join(front, 'admin.html'), 'utf8'));
  const section = parsed.window.document.querySelector('#section-register'); section.hidden = false;
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><link rel="stylesheet" href="/assets/admin-register.css"><style>body{background:#111;font:16px Arial;margin:12px}</style>${section.outerHTML}<script>
  window.CRONOX_API={getCsrfHeaders:async()=>({})};
  window.CRONOX_SECURITY={productImageUrl:()=>''};
  window.CRONOX_AFTER_SALES={canLeave:()=>true,status:()=>({}),hasPending:()=>false};
  window.CRONOX_REGISTER_CAMERA={stop(){},start(config){window.scanner=config}};
  </script><script src="/assets/admin-register.js"></script></html>`;
  parsed.window.close();
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(html); }
    const file = path.resolve(front, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(front + path.sep) || !fs.existsSync(file)) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : 'application/javascript');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const evidence = [];
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.route('**/api/admin/register/**', async route => {
        const body = route.request().postDataJSON();
        if (route.request().url().endsWith('/barcode')) {
          const unknown = body.code.endsWith('9');
          return route.fulfill({ status: unknown ? 404 : 200, json: unknown ? { message: 'Código de prenda desconocido.' } : [{ productId: 7, variantId: 13, lotId: 'old', name: 'CORE TEE', size: 'M', stock: 9, unitPriceCents: 2300 }] });
        }
        const items = body.items.map(line => ({ ...line, name: 'CORE TEE', size: 'M', unitPriceCents: 2300, subtotalCents: 2300 * line.quantity }));
        const units = items.reduce((n, line) => n + line.quantity, 0);
        return route.fulfill({ json: { items, units, totalCents: units * 2300, revision: 'r' } });
      });
      await page.goto(origin);
      await page.evaluate(() => window.CRONOX_REGISTER.open());
      for (const action of ['purchase', 'no-event', 'guest', 'camera']) await page.locator(`[data-act="${action}"]`).click();
      await page.evaluate(() => {
        const v = document.querySelector('[data-camera] video');
        v.poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#414640"/><rect x="200" y="150" width="240" height="150" rx="12" fill="#202820"/></svg>');
      });
      const before = await page.locator('[data-camera]').boundingBox();
      await page.evaluate(() => window.scanner.onRead('CRL0000000001', { center: { x: .02, y: .02 } }));
      await page.locator('#register-feedback.register-success').waitFor();
      await page.screenshot({ path: path.join(out, `${width}-accepted.png`), fullPage: true });
      const sizes = await page.evaluate(() => {
        const box = document.querySelector('[data-camera-indicators]').getBoundingClientRect();
        const mark = document.querySelector('.register-camera-result').getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth, inside: mark.left >= box.left && mark.right <= box.right && mark.top >= box.top && mark.bottom <= box.bottom };
      });
      assert.equal(sizes.overflow, false); assert.equal(sizes.inside, true);
      assert.deepEqual(await page.locator('[data-camera]').boundingBox(), before, 'Overlay moved the camera');
      await page.waitForTimeout(1550); assert.equal(await page.locator('.register-camera-result').count(), 0);
      await page.evaluate(() => window.scanner.onRead('CRL0000000009'));
      await page.locator('#register-feedback.register-error').waitFor();
      await page.screenshot({ path: path.join(out, `${width}-unknown.png`), fullPage: true });
      assert.match(await page.locator('#register-ticket footer').innerText(), /1 uds/);
      // Exercise the actual packaged WASM decoder on generated CRONOX Code128 labels.
      await page.addScriptTag({ url: origin + '/assets/qr-reader.js' });
      for (const code of ['CRX0000000001', 'CRL0000000001']) {
        const png = await bwip.toBuffer({ bcid: 'code128', text: code, scale: 3, height: 10, padding: 15, backgroundcolor: 'FFFFFF' });
        const result = await page.evaluate(async data => {
          const image = new Image(); image.src = data; await image.decode();
          const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
          canvas.getContext('2d').drawImage(image, 0, 0);
          const reader = await window.CRONOX_QR_READER.createReader('Code128');
          const detailed = await reader.decodeResultFromCanvas(canvas);
          return { text: detailed.text, position: detailed.position, legacy: await reader.decodeFromCanvas(canvas) };
        }, 'data:image/png;base64,' + png.toString('base64'));
        assert.equal(result.text, code); assert.equal(result.legacy, code); assert.ok(result.position.topLeft);
      }
      evidence.push({ width, ...sizes, overlayDurationMs: 1500, realCode128AndCoordinates: true });
      await page.close();
    }
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
