'use strict';
require('reflect-metadata');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
const backend = path.resolve(__dirname, '..'),
  out = path.resolve(backend, '../output/playwright/physical-labels-50x35');
require('ts-node').register({
  project: path.join(backend, 'tsconfig.json'),
  transpileOnly: true,
});
const { LabelLayoutDto } = require('../src/admin/labels/labels.dto');
const {
  labelPdf,
  labelSvg,
  labelDocument,
  barcodeSvg,
} = require('../src/admin/labels/label-document');
const { defaultLabelTemplate } = require('../src/admin/labels/label-template');
const sharp = require('sharp'),
  zxing = require('zxing-wasm/reader');
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const lines = [
    {
      code: 'CRX0000000001',
      name: 'Sudadera edición CRONOX con un nombre especialmente largo que nunca debe invadir las barras',
      size: 'XXL',
      quantity: 3,
    },
    {
      code: 'CRX2147483647',
      name: 'ANILLO CON NOMBRELARGOSINESPACIOS'.repeat(5),
      size: 'US 8',
      quantity: 1,
    },
  ];
  const initial = Object.assign(new LabelLayoutDto(), {
      profile: 'brother-ql700-dk22223',
      width: 50,
      pageWidth: 50,
    }),
    alternative = {
      ...initial,
      height: 35,
      pageHeight: 35,
      orientation: 'portrait',
    };
  assert.equal(initial.width, 50);
  assert.equal(initial.height, 35);
  for (const layout of [
    { ...initial, orientation: 'rotated' },
    { ...initial, padding: 2 },
  ]) {
    assert.throws(
      () => labelDocument(lines, layout),
      /horizontal|No se comprimirá/,
    );
    await assert.rejects(
      () => labelPdf(lines, layout),
      /horizontal|No se comprimirá/,
    );
  }
  const svg = labelSvg(lines[0], alternative);
  assert.equal(barcodeSvg(lines[0].code).width, 46.8);
  fs.writeFileSync(path.join(out, 'label-50x35.svg'), svg);
  fs.writeFileSync(
    path.join(out, 'preview-50x35.html'),
    labelDocument(lines, alternative),
  );
  fs.writeFileSync(
    path.join(out, 'brother-50x35.pdf'),
    await labelPdf(lines, alternative),
  );
  const longer = {
    ...alternative,
    height: 40,
    pageHeight: 40,
    margin: 4,
    padding: 1.55,
  };
  const edited = defaultLabelTemplate(longer);
  edited.elements.forEach((e) => {
    if (['brand', 'color', 'identifier'].includes(e.kind)) e.visible = false;
  });
  edited.elements.splice(4, 0, {
    id: 'custom-proof',
    kind: 'custom',
    visible: true,
    text: 'SERIE LOCAL',
    fontSizePt: 8,
    align: 'right',
    gapAfter: 1,
    maxLines: 1,
  });
  fs.writeFileSync(
    path.join(out, 'template-edited-50x40.pdf'),
    await labelPdf([{ ...lines[0], quantity: 1 }], edited),
  );
  fs.writeFileSync(
    path.join(out, 'template-edited-50x40.svg'),
    labelSvg(lines[0], edited),
  );
  const inspected = spawnSync(
    'python',
    [path.join(__dirname, 'verify-physical-labels-pdf.py'), out],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(inspected.status, 0, inspected.stdout + inspected.stderr);
  zxing.prepareZXingModule({
    overrides: {
      wasmBinary: fs.readFileSync(
        path.resolve(
          backend,
          '../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',
        ),
      ),
    },
  });
  for (const row of JSON.parse(
    fs.readFileSync(path.join(out, 'pdf-inspection.json'), 'utf8'),
  )) {
    const decoded = await zxing.readBarcodes(
      fs.readFileSync(path.join(out, row.png)),
      { formats: ['Code128'], tryHarder: true, tryRotate: true },
    );
    assert.ok(
      decoded.some((r) => r.text === row.identifier),
      'PDF decoding failed: ' + row.png,
    );
  }
  for (const line of lines) {
    const png = await sharp(Buffer.from(labelSvg(line, alternative)), {
      density: 300,
    })
      .resize({
        width: Math.ceil((alternative.width * 300) / 25.4),
        height: Math.ceil((alternative.height * 300) / 25.4),
        fit: 'fill',
      })
      .withMetadata({ density: 300 })
      .flatten({ background: '#fff' })
      .png()
      .toBuffer();
    const decoded = await zxing.readBarcodes(png, {
      formats: ['Code128'],
      tryHarder: true,
      tryRotate: true,
    });
    assert.ok(
      decoded.some((r) => r.text === line.code),
      'SVG decoding failed: ' + line.code,
    );
  }
  const report = {
    ok: true,
    initial: '50x35 horizontal; contextual rotation only -90 degrees',
    moduleMm: 0.3,
    quietZoneModules: 11,
    printableWidthMm: 46.9,
    pages: 4,
    extraMarginTest:
      '50x40 with 1.55mm sides / 4mm ends; hidden fields and custom text',
    svgDecoded300dpi: true,
    pdfDecoded300dpi: true,
    vectorOnly: true,
    emptyPages: 0,
  };
  fs.writeFileSync(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
