'use strict';
require('reflect-metadata');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const {
  loadLocalEnvironment,
  ensureLocalPostgres,
} = require('./start-local.cjs');
async function main() {
  const env = loadLocalEnvironment();
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(env.DATABASE_URL).hostname,
    ),
  );
  ensureLocalPostgres(env);
  Object.assign(process.env, env);
  require('ts-node').register({
    project: path.resolve(__dirname, '../tsconfig.json'),
    transpileOnly: true,
  });
  const { PrismaClient } = require('@prisma/client'),
    {
      AdminLabelsService,
    } = require('../src/admin/labels/admin-labels.service'),
    {
      labelPresentation,
      automaticLabelContent,
    } = require('../src/admin/labels/label-presentation'),
    { automaticLabelTemplate } = require('../src/admin/labels/label-template'),
    {
      labelSvg,
      labelDocument,
      labelPdf,
    } = require('../src/admin/labels/label-document');
  const db = new PrismaClient(),
    service = new AdminLabelsService(db),
    out = path.resolve(
      __dirname,
      '../../output/playwright/physical-labels-62x35',
    );
  fs.mkdirSync(out, { recursive: true });
  try {
    const snapshot = async () => {
      const result = {};
      for (const table of [
        'Product',
        'ProductVariant',
        'Order',
        'OrderItem',
        'InventoryLot',
        'InventoryLotSlice',
        'User',
        'LabelTemplateSettings',
      ])
        result[table] = (
          await db.$queryRawUnsafe(
            `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) AS hash FROM "${table}" t`,
          )
        )[0].hash;
      return result;
    };
    const before = await snapshot(),
      identities = await db.physicalBarcode.findMany({
        orderBy: { code: 'asc' },
      });
    const products = await db.product.findMany({
      where: { name: { contains: 'CORE TEE', mode: 'insensitive' } },
      include: {
        variants: {
          include: { physicalBarcode: true },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });
    const selected = [];
    for (const color of ['BLACK', 'GREY']) {
      const product = products.find(
        (p) => labelPresentation(p).color === color,
      );
      if (!product) continue;
      const variant =
        (color === 'BLACK'
          ? product.variants.find((v) => v.size === 'XS')
          : product.variants.find((v) => v.size === 'M')) ||
        product.variants.find((v) => v.physicalBarcode) ||
        product.variants[0];
      if (variant) selected.push({ product, variant });
    }
    if (!selected.length)
      throw Error(
        'No se encontraron variantes CORE TEE con color fiable en el catálogo local.',
      );
    const layout = automaticLabelTemplate(),
      lines = [];
    for (const { product, variant } of selected) {
      const identity = variant.physicalBarcode;
      if (!identity)
        throw Error(
          'Falta el c?digo persistente: gen?ralo expl?citamente desde Etiquetas antes de esta vista.',
        );
      lines.push(automaticLabelContent(product, variant, identity.code, 1));
    }
    fs.writeFileSync(
      path.join(out, 'real-labels.pdf'),
      await labelPdf(lines, layout),
    );
    fs.writeFileSync(
      path.join(out, 'real-labels.html'),
      labelDocument(lines, layout),
    );
    const sharp = require('sharp');
    for (let i = 0; i < lines.length; i++) {
      const svg = labelSvg(lines[i], layout);
      fs.writeFileSync(path.join(out, `label-${i + 1}.svg`), svg);
      await sharp(Buffer.from(svg), { density: 300 })
        .resize({ width: 733, height: 414, fit: 'fill' })
        .withMetadata({ density: 300 })
        .png()
        .toFile(path.join(out, `label-${i + 1}-300dpi.png`));
      const nested = svg
          .replace(/width="[^"]*"/, 'width="62"')
          .replace(/height="[^"]*"/, 'height="35"'),
        context = `<svg xmlns="http://www.w3.org/2000/svg" width="550" height="1050" viewBox="0 0 55 105"><rect width="55" height="105" fill="black"/><g transform="translate(10 83.5) rotate(-90)">${nested}</g></svg>`;
      await sharp(Buffer.from(context))
        .resize(330, 630)
        .png()
        .toFile(path.join(out, `context-${i + 1}.png`));
    }
    assert.deepEqual(await snapshot(), before);
    const after = await db.physicalBarcode.findMany({
      orderBy: { code: 'asc' },
    });
    assert.deepEqual(after, identities);
    for (const identity of identities)
      assert.deepEqual(
        after.find((row) => row.code === identity.code),
        identity,
      );
    const metadata = lines.map((line, i) => ({
      ...line,
      variantId: selected[i].variant.id,
      existingCodePreserved: !!selected[i].variant.physicalBarcode,
    }));
    fs.writeFileSync(
      path.join(out, 'real-labels.json'),
      JSON.stringify(metadata, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          ok: true,
          out,
          labels: metadata,
          originalIdentitiesUnchanged: true,
          catalogueAndSavedTemplatesUnchanged: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
