'use strict';
// Run only after the matching release is publicly available. No redirect service.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const sharp = require('sharp');
const { prepareZXingModule, readBarcodes } = require('zxing-wasm/reader');
const URL = 'https://cronox.es/registro-evento';
async function main() {
  const response = await fetch(URL, { redirect: 'error' });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('name="cronox-event-registration" content="v1"'));
  assert.ok(html.includes('id="authRegisterForm" class="cronox-auth__view is-active"'));
  assert.ok(!html.includes('id="newsletterModal"'));
  await prepareZXingModule({ overrides: { wasmBinary: await fs.readFile(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) } });
  const modules = QRCode.create(URL, { errorCorrectionLevel: 'M' }).modules.size + 8;
  const width = modules * Math.ceil(2400 / modules);
  const options = { errorCorrectionLevel: 'M', margin: 4, width, color: { dark: '#000000ff', light: '#ffffffff' } };
  const png = await QRCode.toBuffer(URL, { ...options, type: 'png' });
  const svg = await QRCode.toString(URL, { ...options, type: 'svg' });
  const results = [];
  for (const [format, input] of [['PNG', png], ['SVG', Buffer.from(svg)]]) {
    for (const size of [width, 300, 240]) {
      const { data, info } = await sharp(input).resize(size, size, { kernel: 'nearest' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const decoded = await readBarcodes({ data: new Uint8ClampedArray(data), width: info.width, height: info.height }, { formats: ['QRCode'], tryHarder: true });
      assert.deepEqual(decoded.map(item => item.text), [URL], `${format} ${size}px decoding`);
      results.push({ format, width: size, decoded: URL });
    }
  }
  const output = path.resolve(process.argv[2] || path.join(__dirname, '../../output/event-registration/qr-final'));
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'cronox-registro-evento.png'), png);
  await fs.writeFile(path.join(output, 'cronox-registro-evento.svg'), svg);
  const report = { url: URL, productionCheckedAt: new Date().toISOString(), pngWidth: width, quietZoneModules: 4, errorCorrection: 'M', checks: results };
  await fs.writeFile(path.join(output, 'verification-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
