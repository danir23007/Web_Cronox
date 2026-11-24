'use strict';
// Read-only catalogue audit + anonymous image GETs. No Nest, SMTP or workers.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
async function main() {
  assert.ok(process.argv.includes('--production'), 'EXPLICIT_PRODUCTION_TARGET_REQUIRED');
  const config = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env'))), dbUrl = new URL(config.DATABASE_URL);
  assert.ok(dbUrl.hostname.endsWith('.supabase.com') && decodeURIComponent(dbUrl.username).includes('frqlgocxnyppzdgxxjuq'));
  Object.assign(process.env, config, { NODE_ENV: 'production', EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false' });
  const { PrismaClient } = require('@prisma/client'), sharp = require('sharp');
  const { createCartProductThumbnail, cartProductThumbnail, trustedOrderImageUrl } = require('../dist/email/managed/order-product-thumbnail');
  const db = new PrismaClient(), output = path.resolve(__dirname, '../../output/playwright/cart-mail-cover/production');
  const get = async url => {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
    assert.equal(response.status, 200); return Buffer.from(await response.arrayBuffer());
  };
  try {
    const products = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return tx.product.findMany({ where: { isActive: true }, select: { id: true, imageUrl: true, images: { where: { isActive: true, archivedAt: null }, orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }], take: 1, select: { url: true, width: true, height: true } } } });
    });
    const photos = products.filter(p => p.images[0]?.url || p.imageUrl);
    assert.ok(photos.length);
    assert.ok(photos.every(p => trustedOrderImageUrl(p.images[0]?.url || p.imageUrl)), 'UNSUPPORTED_ACTIVE_CATALOGUE_PHOTO');
    const selected = new Map();
    for (const product of photos) {
      const image = product.images[0], aspect = image?.width === image?.height ? 'square' : image?.width > image?.height ? 'landscape' : 'portrait';
      if (!selected.has(aspect)) selected.set(aspect, product);
    }
    fs.mkdirSync(output, { recursive: true });
    const checked = [];
    for (const [aspect, product] of selected) {
      const sourceUrl = product.images[0]?.url || product.imageUrl, url = cartProductThumbnail(product).imageUrl;
      const original = await get(sourceUrl), actual = await get(url), expected = await createCartProductThumbnail(original);
      const metadata = await sharp(actual).metadata(); assert.deepEqual([metadata.width, metadata.height, metadata.format], [140, 140, 'png']);
      const decoded = async bytes => sharp(bytes).ensureAlpha().raw().toBuffer();
      assert.equal(hash(await decoded(actual)), hash(await decoded(expected)), 'PRODUCTION_CROP_DIFFERS_FROM_CENTERED_DERIVATIVE');
      assert.equal(hash(await get(sourceUrl)), hash(original), 'ORIGINAL_PHOTO_CHANGED');
      fs.writeFileSync(path.join(output, `${aspect}-${product.id}.png`), actual);
      checked.push({ aspect, productId: product.id, url, width: 140, height: 140, centeredCropVerified: true, originalUnchanged: true, anonymous: true });
    }
    const result = { checkedAt: new Date().toISOString(), activeCataloguePhotosAudited: photos.length, resources: checked, smtp: 'forbidden', database: 'read-only' };
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error.code || error.name || 'CROP_VERIFICATION_FAILED'); process.exitCode = 1; });
