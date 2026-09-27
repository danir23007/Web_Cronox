// Imports an approved public-content export into an EMPTY local catalogue.
// Never connects to the source database and never contacts asset storage.
// Historical orders use the separate local-order-snapshot.cjs export/import flow;
// it must not re-import or overwrite this catalogue or its local private costs.
const fs = require('node:fs');
const { PrismaClient, Prisma } = require('@prisma/client');
const { loadLocalEnvironment } = require('./start-local.cjs');
const models = ['Category', 'Product', 'ProductVariant', 'ProductCategory', 'ProductImage',
  'GalleryAsset', 'GalleryAssetProduct', 'GallerySlot', 'GalleryCarouselSlot',
  'GallerySettings', 'WebsiteMediaAsset', 'WebsiteMediaPlacement', 'FooterSettings',
  'FooterPageContent', 'NewsletterSettings'];
const key = name => name[0].toLowerCase() + name.slice(1);
async function main() {
  if (process.argv[2] === '--configuration') return require('./import-local-configuration.cjs')();
  if (!process.argv[2]) throw new Error('Provide the approved public-content JSON export path.');
  const env = loadLocalEnvironment();
  const url = new URL(env.DATABASE_URL);
  if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/cronox_dev') {
    throw new Error('Import requires 127.0.0.1:5433/cronox_dev.');
  }
  const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  if (Object.keys(data).some(name => !models.includes(name))) throw new Error('Unapproved table in export.');
  // Only assets referenced by public placement/newsletter settings are needed.
  const mediaIds = new Set([
    ...(data.WebsiteMediaPlacement || []).map(row => row.assetId),
    ...(data.NewsletterSettings || []).map(row => row.mediaAssetId),
  ].filter(Boolean));
  data.WebsiteMediaAsset = (data.WebsiteMediaAsset || []).filter(row => mediaIds.has(row.id));
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    await db.$transaction(async tx => {
      for (const name of models) {
        if (await tx[key(name)].count()) throw new Error(`${name} contains local records; refusing to overwrite.`);
      }
      for (const name of models) {
        const definition = Prisma.dmmf.datamodel.models.find(model => model.name === name);
        const fields = definition.fields.filter(field => field.kind !== 'object' && field.name !== 'updatedBy');
        const rows = (data[name] || []).map(row => Object.fromEntries(fields
          .filter(field => Object.hasOwn(row, field.name))
          .map(field => [field.name, field.type === 'Json' && row[field.name] === null ? Prisma.DbNull : row[field.name]])));
        if (rows.length) await tx[key(name)].createMany({ data: rows });
        // Imported IDs must not collide with the next product/image created locally.
        const id = fields.find(field => field.name === 'id' && field.type === 'Int' && field.isId);
        if (id) await tx.$queryRawUnsafe(`SELECT setval(pg_get_serial_sequence('"${name}"', 'id'), COALESCE((SELECT MAX(id) FROM "${name}"), 1), EXISTS(SELECT 1 FROM "${name}"))`);
      }
    }, { timeout: 60000 });
    console.log(JSON.stringify({ destination: '127.0.0.1:5433/cronox_dev', imported: Object.fromEntries(models.map(name => [name, (data[name] || []).length])) }, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
