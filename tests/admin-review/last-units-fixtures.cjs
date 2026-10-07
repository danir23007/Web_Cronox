// Disposable local fixtures for the last-units browser review. Never uses .env.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const bcrypt = require('../../cronox-backend/node_modules/bcrypt');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');

(async () => {
  const env = loadLocalEnvironment(), target = new URL(env.DATABASE_URL);
  assert.equal(target.host, '127.0.0.1:5433');
  assert.equal(target.pathname, '/cronox_dev');
  assert.equal(env.EMAIL_ENABLED, 'false');
  assert.equal(env.BACKGROUND_JOBS_ENABLED, 'false');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const directory = path.resolve('output/playwright/last-units');
  const manifest = path.join(directory, 'fixtures-private.json');
  fs.mkdirSync(directory, { recursive: true });
  try {
    if (process.argv[2] === 'cleanup') {
      const fixture = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      assert(fixture.tag.startsWith('qa-last-units-'));
      const actor = await db.user.findUnique({ where: { id: fixture.actor.id }, select: { email: true } });
      assert(actor?.email === fixture.actor.email && actor.email === fixture.tag + '@example.test');
      // Verify ownership before deleting anything; IDs are never sourced from production.
      const owned = await db.product.findMany({ where: { id: { in: fixture.products.map(p => p.id) } }, select: { id: true, slug: true } });
      assert(owned.every(p => p.slug.startsWith(fixture.tag)));
      const ids = owned.map(p => p.id);
      await db.$transaction(async tx => {
        // Logout can transfer the disposable user's cart to a guest owner.
        // Remove only carts wholly composed of our owned fixture products.
        await tx.cart.deleteMany({ where: { items: {
          some: { variant: { productId: { in: ids } } },
          every: { variant: { productId: { in: ids } } },
        } } });
        await tx.cart.deleteMany({ where: { userId: fixture.actor.id } });
        await tx.cartItem.deleteMany({ where: { variant: { productId: { in: ids } } } });
        await tx.restockRequest.deleteMany({ where: { userId: fixture.actor.id } });
        await tx.favorite.deleteMany({ where: { productId: { in: ids } } });
        await tx.productImage.deleteMany({ where: { productId: { in: ids } } });
        await tx.stockMovement.deleteMany({ where: { variant: { productId: { in: ids } } } });
        await tx.productVariant.deleteMany({ where: { productId: { in: ids } } });
        await tx.productCost.deleteMany({ where: { productId: { in: ids } } });
        await tx.auditLog.deleteMany({ where: { actorId: fixture.actor.id } });
        await tx.product.deleteMany({ where: { id: { in: ids }, slug: { startsWith: fixture.tag } } });
        await tx.user.deleteMany({ where: { id: fixture.actor.id, email: fixture.actor.email } });
      });
      fs.unlinkSync(manifest);
      console.log('Disposable local fixtures removed.');
      return;
    }
    assert(!fs.existsSync(manifest), 'Clean up the previous fixtures first');
    const tag = 'qa-last-units-' + randomUUID().slice(0, 8);
    const password = 'Local-QA-' + randomUUID();
    const actor = await db.user.create({ data: { email: tag + '@example.test', name: 'Local QA', role: 'SUPERADMIN', accountState: 'ACTIVE', password: await bcrypt.hash(password, 10) } });
    const fixture = { tag, actor: { id: actor.id, email: actor.email, password }, products: [] };
    const persist = () => fs.writeFileSync(manifest, JSON.stringify(fixture));
    persist();
    for (const [label, threshold, sizes, sizeSystem = 'APPAREL'] of [
      ['six', 5, [3, 3]], ['five', 5, [2, 3]], ['one', 5, [1, 0]], ['empty', 5, [0, 0]],
      ['disabled', null, [2, 3]], ['zero', 0, [2, 3]], ['inactive', 5, [2, 3]],
      ['disabled-empty', null, [0, 0]], ['zero-empty', 0, [0, 0]],
      ['one-out', 5, [0, 1, 1, 1, 1]], ['two-out', 5, [0, 0, 1, 1, 1]],
      ['three-out', 5, [0, 0, 0, 1, 1]], ['four-out', 5, [0, 0, 0, 0, 1]],
      ['short-out', 5, [0]],
      ['priority-m', 5, [1, 1, 1, 1, 1, 1]], ['priority-s', 5, [1, 1, 0, 1, 1, 1]],
      ['priority-l', 5, [1, 0, 0, 1, 1, 1]], ['priority-xs', 5, [1, 0, 0, 0, 1, 1]],
      ['priority-xl', 5, [0, 0, 0, 0, 1, 1]], ['priority-xxl', 5, [0, 0, 0, 0, 0, 1]],
      ['ring', 5, [0, 1, 2], 'US_RING'], ['ring-empty', 5, [0, 0, 0], 'US_RING'],
    ]) {
      const product = await db.product.create({ data: {
        slug: tag + '-' + label, name: tag + ' ' + label, searchText: tag + ' ' + label,
        price: 4200, lastUnitsThreshold: threshold, sizeSystem,
        privateCost: { create: { unitCostCents: 1700 } },
        images: { create: [
          { url: 'http://127.0.0.1:3000/assets/logo-topbar.webp', isPrimary: true, sortOrder: 0 },
          { url: 'http://127.0.0.1:3000/assets/CRONOX-preloader.webp', sortOrder: 1 },
        ] },
        variants: { create: [
          ...sizes.map((stockQty, index) => ({ size: sizeSystem === 'US_RING' ? ['US_6', 'US_7', 'US_8'][index] : sizes.length > 2 ? ['XS', 'S', 'M', 'L', 'XL', 'XXL'][index] : index ? 'M' : 'S', stockQty, sku: tag + '-' + label + '-' + index })),
          ...(label === 'inactive' ? [{ size: 'L', stockQty: 100, sku: tag + '-inactive-L', isActive: false }] : []),
        ] },
      }, include: { variants: true } });
      fixture.products.push({ id: product.id, slug: product.slug, label, variants: product.variants.map(v => ({ id: v.id, size: v.size, stockQty: v.stockQty })) });
      persist();
    }
    await db.favorite.create({ data: { userId: actor.id, productId: fixture.products.find(p => p.label === 'five').id } });
    for (const [template, output] of [['last-units.browser.js', 'browser-private.js'], ['last-units-actions.browser.js', 'actions-private.js'], ['quick-add-selection.browser.js', 'selection-private.js']]) {
      const source = fs.readFileSync(path.join(__dirname, template), 'utf8').replace('__FIXTURE__', JSON.stringify(fixture));
      fs.writeFileSync(path.join(directory, output), source);
    }
    console.log(`Local fixtures ready: ${fixture.products.length} products and one disposable SUPERADMIN.`);
  } finally { await db.$disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
