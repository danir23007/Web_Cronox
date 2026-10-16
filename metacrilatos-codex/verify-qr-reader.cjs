// Purely local graphics/decoder test: these synthetic strings are not credentials.
// node metacrilatos-codex/verify-qr-reader.cjs
const fs = require('node:fs');
const crypto = require('node:crypto');
const sharp = require('../cronox-backend/node_modules/sharp');
const QRCode = require('../cronox-backend/node_modules/qrcode');
const { prepareZXingModule, readBarcodes } = require('zxing-wasm/reader');

async function main() {
  await prepareZXingModule({ overrides: {
    wasmBinary: fs.readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')),
  } });
  // This first regression case defeated the older JavaScript detector even at
  // its original 592px size. Keep the content, colors, ECC and automatic mask.
  const payloads = ['CRX:1:JrXl5aPPqWpvx2Ud65_GoCrWbGXvlun9'];
  for (let i = 0; i < 50; i++) {
    const bytes = crypto.createHash('sha256').update(`METACRILATOS local decoder fixture ${i}`).digest();
    payloads.push(`CRX:1:${bytes.subarray(0, 24).toString('base64url')}`);
    payloads.push(`CRX:1:${bytes.subarray(0, 16).toString('hex')}`);
    payloads.push(`CRX:1:${bytes.toString('hex')}`);
  }
  for (const payload of payloads) {
    const png = await QRCode.toBuffer(payload, {
      width: 592, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#49212c', light: '#e9d8c4' },
    });
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const decoded = await readBarcodes({ data: new Uint8ClampedArray(data), width: info.width, height: info.height }, {
      formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1,
    });
    if (decoded[0]?.text !== payload) throw new Error('Synthetic QR round-trip failed.');
  }
  console.log(`Decoded ${payloads.length}/${payloads.length} synthetic 32-base64url, 32-hex and 64-hex QR payloads, approved colors, ECC M, margin 4.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
