// Disposable local PostgreSQL data only. Compare Prisma transaction compatibility
// and native session/prepared mode without changing the connection limit.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('../../cronox-backend/node_modules/@prisma/client');
const { ProductService } = require('../../cronox-backend/dist/products/product.service');
const { AuthSessionsService } = require('../../cronox-backend/dist/auth/auth-sessions.service');
const { loadLocalEnvironment } = require('../../cronox-backend/scripts/start-local.cjs');

(async () => {
  const env = loadLocalEnvironment(), url = new URL(env.DATABASE_URL);
  assert.equal(url.host, '127.0.0.1:5433');
  assert.equal(url.pathname, '/cronox_dev');
  assert.equal(env.EMAIL_ENABLED, 'false');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.delete('pgbouncer');
  const db = new PrismaClient({ datasources: { db: { url: String(url) } } });
  const tag = 'pool-qa-' + randomUUID();
  let product, user;
  try {
    product = await db.product.create({ data: {
      name: tag, slug: tag, searchText: tag, price: 1200, description: 'Disposable QA',
      privateCost: { create: { unitCostCents: 700 } },
      variants: { create: [{ size: 'M', sku: tag, stockQty: 4 }] },
      images: { create: [{ url: '/assets/fixture.jpg', isPrimary: true, sortOrder: 0 }] },
    } });
    user = await db.user.create({ data: { email: tag + '@example.test', role: 'SUPERADMIN', accountState: 'ACTIVE' } });
    const sid = randomUUID();
    await db.authSession.create({ data: { id: sid, userId: user.id, sessionVersion: user.sessionVersion,
      refreshHash: 'fixture-only', refreshIssuedAt: Math.floor(Date.now() / 1000) } });
    let baseline;
    for (const compatibility of [true, false]) {
      const target = new URL(url);
      if (compatibility) target.searchParams.set('pgbouncer', 'true');
      const client = new PrismaClient({ datasources: { db: { url: String(target) } } });
      try {
        const service = new ProductService(client), auth = new AuthSessionsService(client);
        for (let repeat = 0; repeat < 3; repeat++) {
          const [list, detail, stock, session] = await Promise.all([
            service.listAdminProducts({ view: 'summary', search: tag }),
            service.getAdminProduct(product.id),
            service.listAdminProducts({ view: 'summary', search: tag, sortBy: 'stock' }),
            auth.validate({ sub: user.id, sv: user.sessionVersion, sid, type: 'access' }),
          ]);
          assert.equal(list.totalItems, 1); assert.equal(stock.totalItems, 1);
          assert.equal(session.user.id, user.id);
          const result = JSON.parse(JSON.stringify({ list, detail, stock, session }));
          if (baseline) assert.deepEqual(result, baseline); else baseline = result;
        }
        await assert.rejects(auth.validate({ sub: user.id, sv: user.sessionVersion + 1, sid, type: 'access' }));
      } finally { await client.$disconnect(); }
    }
    console.log('PASS: both modes, repeated/concurrent reads, detail, stock order, private cost and session validation agree.');
  } finally {
    if (product) {
      await db.productImage.deleteMany({ where: { productId: product.id } });
      await db.productVariant.deleteMany({ where: { productId: product.id } });
      await db.product.delete({ where: { id: product.id } });
    }
    if (user) await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
