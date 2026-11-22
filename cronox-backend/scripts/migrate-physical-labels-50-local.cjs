'use strict';
require('reflect-metadata');
const path = require('node:path'),
  fs = require('node:fs'),
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
    } = require('../src/admin/labels/admin-labels.service');
  const db = new PrismaClient(),
    service = new AdminLabelsService(db);
  try {
    const identities = await db.physicalBarcode.findMany({
      orderBy: { code: 'asc' },
    });
    const current = await service.template();
    if (!current.migrationValid) throw Error(current.notice);
    let result = current;
    if (current.needsMigration || !current.saved)
      result = await service.saveTemplate({
        revision: current.revision,
        template: current.template,
      });
    assert.deepEqual(
      await db.physicalBarcode.findMany({ orderBy: { code: 'asc' } }),
      identities,
    );
    if (process.argv.includes('--preview')) {
      let variant = await db.productVariant.findFirst({
        where: {
          physicalBarcode: { isNot: null },
          product: { isActive: true },
        },
        orderBy: { id: 'asc' },
        include: { physicalBarcode: true, product: { select: { name: true } } },
      });
      if (!variant)
        variant = await db.productVariant.findFirst({
          where: { product: { isActive: true } },
          orderBy: { id: 'asc' },
          include: {
            physicalBarcode: true,
            product: { select: { name: true } },
          },
        });
      if (!variant)
        throw Error(
          'No hay variantes locales disponibles para la vista previa.',
        );
      const generatedMissingIdentity = !variant.physicalBarcode;
      const identity = (
        await service.generate({
          lines: [{ variantId: variant.id, quantity: 1 }],
        })
      ).items[0];
      const {
        labelSvg,
        labelDocument,
        labelPdf,
      } = require('../src/admin/labels/label-document');
      const out = path.resolve(
        __dirname,
        '../../output/playwright/physical-labels-50x35',
      );
      fs.mkdirSync(out, { recursive: true });
      const line = {
          code: identity.code,
          name: variant.product.name,
          size: variant.size.replace('US_', 'US '),
          quantity: 1,
        },
        definition = result.template;
      const label = labelSvg(line, definition);
      fs.writeFileSync(path.join(out, 'current-label.svg'), label);
      fs.writeFileSync(
        path.join(out, 'current-label.html'),
        labelDocument([line], definition),
      );
      fs.writeFileSync(
        path.join(out, 'current-label.pdf'),
        await labelPdf([line], definition),
      );
      const width = definition.layout.width,
        height = definition.layout.height;
      const nested = label
        .replace(/width="[^"]*"/, `width="${width}"`)
        .replace(/height="[^"]*"/, `height="${height}"`);
      const context = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 55 105" width="550" height="1050"><rect width="55" height="105" fill="black"/><g transform="translate(${(55 - height) / 2} ${(105 + width) / 2}) rotate(-90)">${nested}</g></svg>`;
      fs.writeFileSync(path.join(out, 'context-card.svg'), context);
      const sharp = require('sharp');
      await sharp(Buffer.from(context))
        .resize(330, 630)
        .png()
        .toFile(path.join(out, 'context-card-preview.png'));
      await sharp(Buffer.from(label), { density: 300 })
        .resize({width:Math.ceil(width*300/25.4),height:Math.ceil(height*300/25.4),fit:'fill'})
        .withMetadata({density:300})
        .flatten({ background: '#fff' })
        .png()
        .toFile(path.join(out, 'current-label-300dpi.png'));
      fs.writeFileSync(
        path.join(out, 'preview-metadata.json'),
        JSON.stringify(
          {
            variantId: variant.id,
            code: identity.code,
            name: variant.product.name,
            size: line.size,
            generatedMissingIdentity,
            paper: { width, height },
            context: {
              width: height,
              height: width,
              rotation: -90,
              sideMargins: (55 - height) / 2,
            },
          },
          null,
          2,
        ),
      );
      console.log(
        JSON.stringify({
          preview: out,
          variantId: variant.id,
          code: identity.code,
          generatedMissingIdentity,
        }),
      );
    }
    console.log(
      JSON.stringify(
        {
          ok: true,
          updated: result.revision !== current.revision,
          revision: result.revision,
          layout: result.template.layout,
          notice:
            current.notice || 'Plantilla inicial de 50 × 35 mm horizontal.',
          existingBarcodeIdentitiesUnchanged: true,
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
