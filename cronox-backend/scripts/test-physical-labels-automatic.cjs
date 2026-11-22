'use strict';
require('reflect-metadata');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process');
const backend = path.resolve(__dirname, '..'),
  out = path.resolve(
    backend,
    '../output/playwright/physical-labels-62x35-tests',
  );
require('ts-node').register({
  project: path.join(backend, 'tsconfig.json'),
  transpileOnly: true,
});
const {
  automaticLabelTemplate,
} = require('../src/admin/labels/label-template');
const {
  automaticLabelContent,
} = require('../src/admin/labels/label-presentation');
const {
  labelPdf,
  labelSvg,
  labelDocument,
  barcodeSvg,
} = require('../src/admin/labels/label-document');
async function main() {
  fs.mkdirSync(out, { recursive: true });
  const template = automaticLabelTemplate(),
    lines = [
      automaticLabelContent(
        { name: 'ASHEN SHELL' },
        { size: 'M' },
        'CRX0000000013',
        1,
      ),
      automaticLabelContent(
        { name: 'CORE TEE - black' },
        { size: 'XS' },
        'CRX0000000001',
        3,
      ),
      automaticLabelContent(
        { name: 'CORE TEE - grey' },
        { size: 'M' },
        'CRX0000000009',
        1,
      ),
      automaticLabelContent(
        {
          name:
            'Nombre especialmente largo sin invadir el código de barras '.repeat(
              4,
            ) + ' - blue',
        },
        { size: 'XXL' },
        'CRX2147483647',
        1,
      ),
    ];
  assert.equal(barcodeSvg(lines[0].code).width, 46.8);
  fs.writeFileSync(
    path.join(out, 'automatic.pdf'),
    await labelPdf(lines, template),
  );
  fs.writeFileSync(
    path.join(out, 'automatic.html'),
    labelDocument(lines, template),
  );
  const cases = [
    {
      file: path.join(out, 'automatic.pdf'),
      lines: lines.flatMap((l) => Array.from({ length: l.quantity }, () => l)),
    },
  ];
  const real = path.resolve(
    backend,
    '../output/playwright/physical-labels-62x35',
  );
  if (fs.existsSync(path.join(real, 'real-labels.json')))
    cases.push({
      file: path.join(real, 'real-labels.pdf'),
      lines: JSON.parse(
        fs.readFileSync(path.join(real, 'real-labels.json'), 'utf8'),
      ),
    });
  if (fs.existsSync(path.join(real, 'browser-download.pdf'))) {
    const [black, grey] = JSON.parse(
      fs.readFileSync(path.join(real, 'real-labels.json'), 'utf8'),
    );
    for (const [file, labels] of [
      ['browser-print-selection.pdf', [black, black, grey]],
      ['browser-test-label.pdf', [black]],
      ['browser-download.pdf', [black, black, grey]],
    ])
      cases.push({ file: path.join(real, file), lines: labels });
  }
  fs.writeFileSync(path.join(out, 'cases.json'), JSON.stringify(cases));
  const check = spawnSync(
    'python',
    [path.join(__dirname, 'verify-automatic-labels-pdf.py'), out],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(check.status, 0, check.stdout + check.stderr);
  const zxing = require('zxing-wasm/reader'),
    sharp = require('sharp');
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
  const inspection = JSON.parse(
    fs.readFileSync(path.join(out, 'inspection.json'), 'utf8'),
  );
  for (const row of inspection) {
    const result = await zxing.readBarcodes(fs.readFileSync(row.png), {
      formats: ['Code128'],
      tryHarder: true,
    });
    assert.ok(
      result.some((r) => r.text === row.code),
      'PDF decode failed ' + row.png,
    );
  }
  for (const line of lines) {
    const svg = labelSvg(line, template);
    assert.equal((svg.match(/text-anchor="middle"/g) || []).length, 1);
    const png = await sharp(Buffer.from(svg), { density: 300 })
      .resize({ width: 733, height: 414, fit: 'fill' })
      .flatten({ background: '#fff' })
      .png()
      .toBuffer();
    const result = await zxing.readBarcodes(png, {
      formats: ['Code128'],
      tryHarder: true,
    });
    assert.ok(
      result.some((r) => r.text === line.code),
      'SVG decode failed ' + line.code,
    );
  }
  const report = {
    ok: true,
    pdfPages: inspection.length,
    selectedQuantities: lines.map((line) => line.quantity),
    paperMm: [62, 35],
    orientation: 'horizontal',
    pdfAndSvgDecoded300dpi: true,
    vectorOnly: true,
    blankPages: 0,
    textAlignedLeftExceptCenteredIdentifier: true,
    uppercase: true,
    brandAndProductOnSameLine: true,
    onlyBrandBold: true,
    barModuleMm: 0.3,
    quietZoneModules: 11,
    printableWidthMm: 58.9,
  };
  fs.writeFileSync(
    path.join(out, 'report.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
