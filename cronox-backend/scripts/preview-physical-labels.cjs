'use strict';
require('reflect-metadata');
// Visual QA only. In-memory fixtures; no database, credentials or external services.
const express = require('express'),
  fs = require('node:fs'),
  path = require('node:path');
require('ts-node').register({
  project: path.resolve(__dirname, '../tsconfig.json'),
  transpileOnly: true,
});
const {
  labelDocument,
  labelSvg,
  labelPdf,
  validateLabelTemplate,
} = require('../src/admin/labels/label-document');
const {
  labelPresentation,
  automaticLabelContent,
} = require('../src/admin/labels/label-presentation');
const {
  defaultLabelTemplate,
  automaticLabelTemplate,
} = require('../src/admin/labels/label-template');
const app = express(),
  front = path.resolve(__dirname, '../../cronox-front');
app.use(express.json());
let sharedTemplate = {
  template: defaultLabelTemplate(),
  defaults: defaultLabelTemplate(),
  revision: 0,
  saved: false,
};
app.get('/api/admin/physical-labels/template', (_req, res) =>
  res.json(sharedTemplate),
);
app.post('/api/admin/physical-labels/template', (req, res) => {
  try {
    if (req.body.revision !== sharedTemplate.revision)
      return res
        .status(409)
        .json({ message: 'La plantilla ha cambiado en otro dispositivo.' });
    validateLabelTemplate(req.body.template);
    sharedTemplate = {
      ...sharedTemplate,
      template: req.body.template,
      revision: sharedTemplate.revision + 1,
      saved: true,
    };
    res.json(sharedTemplate);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
app.post('/api/admin/physical-labels/template/reset', (req, res) => {
  if (req.body.revision !== sharedTemplate.revision)
    return res
      .status(409)
      .json({ message: 'La plantilla ha cambiado en otro dispositivo.' });
  sharedTemplate = {
    ...sharedTemplate,
    template: defaultLabelTemplate(),
    revision: sharedTemplate.revision + 1,
    saved: true,
  };
  res.json(sharedTemplate);
});
const items = [
  {
    id: 1,
    name: 'CORE TEE - black',
    slug: 'sudadera-negra',
    isActive: true,
    imageUrl: '/fixture.svg',
    images: [],
    variants: [
      {
        id: 1,
        size: 'XS',
        sku: 'CR-S',
        stockQty: 0,
        isActive: true,
        physicalBarcode: { code: 'CRX0000000001' },
      },
      {
        id: 2,
        size: 'M',
        sku: 'CR-M',
        stockQty: 7,
        isActive: true,
        physicalBarcode: null,
      },
    ],
  },
  {
    id: 2,
    name: 'CORE TEE - grey',
    slug: 'anillo',
    isActive: false,
    images: [],
    imageUrl: null,
    variants: [
      {
        id: 3,
        size: 'M',
        sku: 'AN-US8',
        stockQty: 0,
        isActive: false,
        physicalBarcode: { code: 'CRX0000000009' },
      },
    ],
  },
];
let generated = 0;
app.get('/fixture.svg', (_req, res) =>
  res
    .type('svg')
    .send(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="black"/><text x="8" y="35" fill="white" font-size="11">CRONOX</text></svg>',
    ),
);
app.get('/api/admin/physical-labels', (req, res) =>
  res.json({
    items: items
      .filter(
        (p) =>
          (!req.query.active || String(p.isActive) === req.query.active) &&
          (!req.query.search ||
            (p.name + p.slug + p.variants.map((v) => v.sku))
              .toLowerCase()
              .includes(String(req.query.search).toLowerCase())),
      )
      .map((p) => ({ ...p, labelPresentation: labelPresentation(p) })),
    layout: automaticLabelTemplate().layout,
    page: 1,
    totalPages: 1,
    total: 2,
  }),
);
app.get('/qa-state', (_req, res) => res.json({ generated }));
app.post('/api/admin/physical-labels/generate', (req, res) => {
  for (const l of req.body.lines) {
    const v = items
      .flatMap((p) => p.variants)
      .find((v) => v.id === l.variantId);
    if (!v.physicalBarcode) {
      v.physicalBarcode = { code: 'CRX' + String(v.id).padStart(10, '0') };
      generated++;
    }
  }
  res.json({ items: [] });
});
app.post('/api/admin/physical-labels/preview', (req, res) => {
  try {
    const lines = req.body.lines.map((l) => {
      const p = items.find((p) => p.variants.some((v) => v.id === l.variantId)),
        v = p.variants.find((v) => v.id === l.variantId);
      if (!v.physicalBarcode)
        throw Error(
          'Faltan códigos. Genera los códigos de la selección antes de ver o imprimir.',
        );
      return automaticLabelContent(p, v, v.physicalBarcode.code, l.quantity);
    });
    res.json({
      html: labelDocument(lines, automaticLabelTemplate()),
      layout: automaticLabelTemplate().layout,
      quantity: lines.reduce((n, l) => n + l.quantity, 0),
      firstLabelSvg: labelSvg(lines[0], automaticLabelTemplate()),
    });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.post('/api/admin/physical-labels/pdf', async (req, res) => {
  try {
    const lines = req.body.lines.map((l) => {
      const p = items.find((p) => p.variants.some((v) => v.id === l.variantId)),
        v = p.variants.find((v) => v.id === l.variantId);
      if (!v.physicalBarcode) throw Error('Faltan códigos.');
      return automaticLabelContent(p, v, v.physicalBarcode.code, l.quantity);
    });
    res
      .type('pdf')
      .set('Content-Disposition', 'attachment; filename="cronox-etiquetas.pdf"')
      .send(await labelPdf(lines, automaticLabelTemplate()));
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});
app.get('/admin.html', (_req, res) => {
  const keep = [
    'admin-theme',
    'version',
    'admin-pagination',
    'admin-navigation',
    'admin-shell',
    'admin-section-headers',
    'admin-labels',
    'admin',
  ];
  let html = fs
    .readFileSync(path.join(front, 'admin.html'), 'utf8')
    .replace(/<script src="([^"]+)"[^>]*><\/script>/g, (tag, src) =>
      keep.includes(path.basename(src.split('?')[0], '.js')) ? tag : '',
    );
  html = html.replace(
    '<script src="assets/admin-navigation',
    '<script>window.CRONOX_API={API_BASE:"",getMe:async()=>({id:1,role:"ADMIN",email:"qa@example.invalid"}),getCsrfHeaders:async()=>({}),admin:{getPendingCounts:async()=>({})}};</script><script src="assets/admin-navigation',
  );
  res.type('html').send(html);
});
app.use(express.static(front));
app.listen(3218, '127.0.0.1', () =>
  console.log(
    'Visual QA fixtures: http://127.0.0.1:3218/admin.html#section-labels',
  ),
);
