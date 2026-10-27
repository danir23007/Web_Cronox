'use strict';
// Disposable loopback DB only. --serve keeps the test UI open until "stop" on stdin.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { spawnSync } = require('node:child_process'),
  { randomUUID } = require('node:crypto'),
  { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..'),
  root = path.resolve(backend, '..');
const name = 'cronox_points_test_' + randomUUID().replace(/-/g, '');
const checks = [];
async function main() {
  const environment = loadLocalEnvironment(),
    source = new URL(environment.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  const control = new Client({ connectionString: source.href });
  let db,
    app,
    created = false;
  try {
    await control.connect();
    const identity = (
      await control.query('SELECT host(inet_server_addr()) AS host')
    ).rows[0];
    assert.ok(['127.0.0.1', '::1'].includes(identity.host));
    assert.match(name, /^cronox_points_test_[a-f0-9]{32}$/);
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const target = new URL(source);
    target.pathname = '/' + name;
    target.search = '';
    const env = {
      ...environment,
      DATABASE_URL: target.href,
      DIRECT_URL: target.href,
      USER_NUMBERING_DATABASE_URL: target.href,
    };
    const sql = new Client({ connectionString: target.href });
    await sql.connect();
    await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const push = spawnSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
      ],
      {
        cwd: backend,
        env,
        windowsHide: true,
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    assert.equal(push.status, 0, push.stderr);
    // Exercise the actual incremental migration, not just Prisma's table creation.
    await sql.query('DROP TABLE "PointEntry", "PointSale", "SalePoint"');
    const migration = fs
      .readdirSync(path.join(backend, 'prisma/migrations'))
      .find((n) => n.endsWith('_external_sale_points'));
    await sql.query(
      fs.readFileSync(
        path.join(backend, 'prisma/migrations', migration, 'migration.sql'),
        'utf8',
      ),
    );
    for (const name of ['20261027230000_point_territory_and_safe_removal','20261027231000_point_place_normalization']) {
      await sql.query(fs.readFileSync(path.join(backend,'prisma/migrations',name,'migration.sql'),'utf8'));
    }
    await sql.query(
      fs.readFileSync(
        path.join(
          backend,
          'prisma/migrations/20261002120000_permanent_visitor_finance_history/migration.sql',
        ),
        'utf8',
      ),
    );
    const reconciliation = fs.readFileSync(
      path.join(
        backend,
        'prisma/migrations/20261002200000_visitor_daily_reconciliation/migration.sql',
      ),
      'utf8',
    );
    await sql.query(
      reconciliation.slice(
        reconciliation.indexOf('CREATE VIEW'),
        reconciliation.indexOf('-- Local PostgreSQL'),
      ),
    );
    await sql.end();
    require('../test/test-environment.cjs').installTestEnvironment({
      force: true,
      overrides: {
        DATABASE_URL: target.href,
        DIRECT_URL: target.href,
        USER_NUMBERING_DATABASE_URL: target.href,
        EMAIL_ENABLED: 'false',
        BACKGROUND_JOBS_ENABLED: 'false',
        CRONOX_ROUTE_SMOKE_MODE: 'true',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        PORT: '43121',
        FRONTEND_URL: 'http://127.0.0.1:43121',
        API_PUBLIC_URL: 'http://127.0.0.1:43121',
        CORS_ORIGINS: 'http://127.0.0.1:43121',
      },
    });
    require('ts-node').register({
      project: path.join(backend, 'tsconfig.json'),
      transpileOnly: true,
    });
    const { PrismaService } = require('../src/prisma/prisma.service');
    db = new PrismaService();
    await db.$connect();
    assert.equal(
      (await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,
      name,
    );
    const {
        AdminPointsService,
      } = require('../src/admin/points/admin-points.service'),
      {
        AdminFinanceService,
      } = require('../src/admin/finance/admin-finance.service');
    const points = new AdminPointsService(db),
      finance = new AdminFinanceService(db);
    const admin = await db.user.create({
        data: { email: 'points-admin@example.test', role: 'SUPERADMIN' },
      }),
      customer = await db.user.create({
        data: { email: 'points-user@example.test', role: 'USER' },
      });
    const p = await db.product.create({
      data: {
        slug: 'points-test-shirt',
        name: 'Camiseta local',
        price: 9999,
        privateCost: { create: { unitCostCents: 1500 } },
        variants: {
          create: [
            { size: 'M', sku: 'POINTS-M', stockQty: 100 },
            { size: 'L', sku: 'POINTS-L', stockQty: 100 },
          ],
        },
      },
      include: { variants: true },
    });
    const p2 = await db.product.create({
      data: {
        slug: 'points-test-jacket',
        name: 'Chaqueta local',
        price: 18000,
        privateCost: { create: { unitCostCents: 2000 } },
        variants: { create: { size: 'M', sku: 'POINTS-J-M', stockQty: 100 } },
      },
      include: { variants: true },
    });
    const variantId = p.variants[0].id,
      otherId = p2.variants[0].id;
    const makePoint = async (label, bp = 0, expense = 0) =>
      (
        await points.savePoint(admin.id, randomUUID(), {
          name: label,
          type: 'EVENT',
          city: 'Madrid',
          venue: 'Local',
          notes: '',
          commissionBp: bp,
          archived: false,
          participationCents: expense,
          expenseDate: '2026-10-01T12:00',
        })
      ).pointId;
    const saleBody = (bp = 0, quantity = 10, price = 5000) => ({
      occurredAt: '2026-10-02T12:00',
      note: '',
      paymentMethod: 'CASH',
      lines: [{ variantId, quantity, unitPriceCents: price, commissionBp: bp }],
    });
    const query = {
      from: '2026-10-01',
      to: '2026-10-31',
      aggregation: 'days',
      currency: 'EUR',
      sort: 'revenue',
      direction: 'desc',
      search: '',
      page: 1,
      source: 'points',
    };
    const detail = async (id) => points.detail(id, query.from, query.to);
    for (const [bp, expense, profit] of [
      [0, 20000, 15000],
      [6000, 0, 5000],
      [2000, 10000, 15000],
    ]) {
      const id = await makePoint('Ejemplo ' + bp, bp, expense);
      await points.sale(id, admin.id, randomUUID(), saleBody(bp));
      const d = await detail(id),
        r = await finance.getReport({ ...query, pointId: id });
      assert.equal(d.report.totals.profitCents, profit);
      assert.deepEqual(r.totals, {
        revenueCents: 50000,
        costCents: 15000,
        profitCents: profit,
        unitsSold: 10,
        unitsReturned: 0,
      });
      assert.equal(
        r.buckets.reduce((s, b) => s + b.profitCents, 0),
        profit,
      );
    }
    checks.push(
      'Three required examples: point/general KPI, chart, product contribution and expense-day match',
    );
    const loss = await makePoint('Sin ventas', 0, 200000);
    assert.equal((await detail(loss)).report.totals.profitCents, -200000);
    assert.equal(
      (
        await finance.getReport({
          ...query,
          pointId: loss,
          from: '2026-10-01',
          to: '2026-10-01',
        })
      ).buckets[0].profitCents,
      -200000,
    );
    const id = await makePoint('Revisión local', 2000);
    const body = saleBody(2000, 2, 2550);
    body.lines.push(
      {
        variantId: otherId,
        quantity: 1,
        unitPriceCents: 10000,
        commissionBp: 6000,
      },
      {
        variantId: p.variants[1].id,
        quantity: 1,
        unitPriceCents: 1000,
        commissionBp: 0,
      },
    );
    const key = randomUUID();
    const parallel = await Promise.all(
      Array.from({ length: 4 }, () => points.sale(id, admin.id, key, body)),
    );
    assert.equal(new Set(parallel.map((r) => r.id)).size, 1);
    const saleId = parallel[0].saleId;
    const stockBefore = (
      await db.productVariant.findUnique({ where: { id: variantId } })
    ).stockQty;
    assert.equal(
      (await points.sale(id, admin.id, key, body)).id,
      parallel[0].id,
    );
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variantId } }))
        .stockQty,
      stockBefore,
    );
    await assert.rejects(
      points.sale(id, admin.id, key, { ...body, note: 'changed' }),
      /Clave reutilizada/,
    );
    const snapshot = (await db.pointSale.findUnique({ where: { id: saleId } }))
      .state;
    await db.productCost.update({
      where: { productId: p.id },
      data: { unitCostCents: 9000 },
    });
    await db.product.update({ where: { id: p.id }, data: { price: 12345 } });
    const point = (await detail(id)).point;
    await points.savePoint(
      admin.id,
      randomUUID(),
      { ...point, commissionBp: 9000, startsOn: undefined, endsOn: undefined },
      id,
    );
    assert.deepEqual(
      (await db.pointSale.findUnique({ where: { id: saleId } })).state,
      snapshot,
    );
    assert.equal(snapshot.lines[0].unitPriceCents, 2550);
    assert.equal(snapshot.lines[0].unitCostCents, 1500);
    checks.push(
      'Backdated multi-product/size sale freezes paid prices, configured costs and per-line commissions; four concurrent retries deduct once; configuration changes preserve history',
    );
    const getSale = () => db.pointSale.findUnique({ where: { id: saleId } });
    let sale = await getSale();
    const corrected = {
      ...body,
      occurredAt: '2026-10-03T12:00',
      revision: sale.revision,
      reason: 'Corregir precio y cantidad',
      lines: sale.state.lines.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        commissionBp: l.commissionBp,
      })),
    };
    corrected.lines[0].quantity = 3;
    corrected.lines[0].unitPriceCents = 3000;
    await points.sale(id, admin.id, randomUUID(), corrected, saleId);
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variantId } }))
        .stockQty,
      stockBefore - 1,
    );
    sale = await getSale();
    assert.equal(sale.state.lines[0].unitCostCents, 1500);
    await assert.rejects(
      points.sale(id, admin.id, randomUUID(), corrected, saleId),
      /revisión actual/,
    );
    const ret = {
      occurredAt: '2026-10-04T12:00',
      revision: sale.revision,
      reason: 'Devuelve dos',
      lines: [
        {
          id: sale.state.lines[0].id,
          quantity: 1,
          restock: true,
          recoveredCommissionCents: 600,
        },
        {
          id: sale.state.lines[1].id,
          quantity: 1,
          restock: false,
          recoveredCommissionCents: 0,
        },
      ],
    };
    const retKey = randomUUID();
    await points.refund(id, saleId, admin.id, retKey, ret);
    await points.refund(id, saleId, admin.id, retKey, ret);
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variantId } }))
        .stockQty,
      stockBefore,
    );
    const r = (await detail(id)).report;
    assert.equal(r.totals.revenueCents, 7000);
    assert.equal(r.totals.costCents, 6500);
    assert.equal(r.totals.commissionCents, 7200);
    assert.equal(r.totals.profitCents, -6700);
    assert.equal(r.netUnits, 3);
    assert.equal(
      (await finance.getReport({ ...query, pointId: id })).totals.profitCents,
      -6700,
    );
    await assert.rejects(
      points.refund(id, saleId, admin.id, randomUUID(), ret),
      /ha cambiado/,
    );
    sale = await getSale();
    const postReturn = {
      ...corrected,
      occurredAt: '2026-10-05T12:00',
      revision: sale.revision,
      reason: 'Corregir unidades pendientes tras devolución',
      lines: sale.state.lines.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        commissionBp: l.commissionBp,
      })),
    };
    postReturn.lines[0].unitPriceCents = 3500;
    await points.sale(id, admin.id, randomUUID(), postReturn, saleId);
    const postReturnReport = (await detail(id)).report;
    assert.equal(postReturnReport.totals.profitCents, -5900);
    assert.equal(postReturnReport.totals.costCents, 6500);
    assert.equal(postReturnReport.totals.commissionCents, 7400);
    checks.push(
      'Correction applies only stock/money differences with frozen cost; partial returns restocked/nonrestocked and recovered/unrecovered commission reconcile; stale revisions reject',
    );
    const counts = await db.pointEntry.count(),
      stock = await db.productVariant.findUnique({ where: { id: variantId } });
    await assert.rejects(
      points.sale(id, admin.id, randomUUID(), saleBody(0, 1000)),
      /Stock insuficiente/,
    );
    assert.equal(await db.pointEntry.count(), counts);
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variantId } }))
        .stockQty,
      stock.stockQty,
    );
    await db.productVariant.update({
      where: { id: variantId },
      data: { stockQty: 1 },
    });
    const concurrent = await Promise.allSettled([
      points.sale(id, admin.id, randomUUID(), saleBody(0, 1)),
      points.sale(
        await makePoint('Concurrente'),
        admin.id,
        randomUUID(),
        saleBody(0, 1),
      ),
    ]);
    assert.equal(concurrent.filter((v) => v.status === 'fulfilled').length, 1);
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variantId } }))
        .stockQty,
      0,
    );
    await db.productVariant.update({
      where: { id: variantId },
      data: { stockQty: 50 },
    });
    await db.productCost.update({
      where: { productId: p.id },
      data: { unitCostCents: null },
    });
    await assert.rejects(
      points.sale(id, admin.id, randomUUID(), saleBody(0, 1)),
      /Falta el coste/,
    );
    await db.productCost.update({
      where: { productId: p.id },
      data: { unitCostCents: 0 },
    });
    const zero = await points.sale(id, admin.id, randomUUID(), saleBody(0, 1));
    assert.equal(zero.after.lines[0].unitCostCents, 0);
    checks.push(
      'Insufficient stock rolls back all records; competing points cannot oversell; explicit zero accepted and missing cost identifies product',
    );
    const exp = await points.expense(id, admin.id, randomUUID(), {
      occurredAt: '2026-10-05T12:00',
      description: 'Alquiler',
      amountCents: 12345,
    });
    const originalProfit = (await detail(id)).report.totals.profitCents;
    const reversal = await points.expense(id, admin.id, randomUUID(), {
      occurredAt: '2026-10-06T12:00',
      description: 'Anular gasto incorrecto',
      amountCents: 0,
      reversesId: exp.id,
    });
    assert.equal(reversal.expenseCents, -12345);
    assert.equal(
      (await detail(id)).report.totals.profitCents,
      originalProfit + 12345,
    );
    await assert.rejects(
      points.expense(id, admin.id, randomUUID(), {
        occurredAt: '2026-10-06T12:00',
        description: 'Repetición',
        amountCents: 0,
        reversesId: exp.id,
      }),
      /ya está anulado/,
    );
    await assert.rejects(
      db.pointEntry.update({
        where: { id: exp.id },
        data: { expenseCents: 0 },
      }),
      /append-only/,
    );
    checks.push(
      'Expenses deduct once, dated reversals preserve history; database rejects ledger updates/deletes',
    );
    const orderData = {
      customerEmail: 'local@example.test',
      taxRate: '0.21',
      taxAmount: '8.85',
      status: 'PAID',
      currency: 'EUR',
      subtotal: '51',
      total: '51',
      shippingCost: 0,
      discountCents: 0,
      items: {
        create: {
          productId: p.id,
          variantId,
          title: 'Camiseta',
          quantity: 2,
          unitPrice: '25.50',
          lineTotal: '51',
          financialSnapshot: {
            create: { unitCostCents: 1500, productName: 'Camiseta' },
          },
        },
      },
    };
    await db.order.create({
      data: {
        ...orderData,
        source: 'IN_PERSON_ADMIN',
        provider: 'manual',
        purchasedAt: new Date('2026-10-02T10:00Z'),
      },
    });
    await db.order.create({
      data: {
        ...orderData,
        source: 'ONLINE',
        paidAt: new Date('2026-10-02T10:00Z'),
      },
    });
    const all = await finance.getReport({ ...query, source: 'all' }),
      web = await finance.getReport({ ...query, source: 'web' }),
      manual = await finance.getReport({ ...query, source: 'manual' }),
      external = await finance.getReport(query);
    assert.equal(web.totals.profitCents, 2100);
    assert.equal(manual.totals.profitCents, 2100);
    assert.equal(all.totals.profitCents, external.totals.profitCents + 4200);
    assert.equal(all.salesCount, external.salesCount + 2);
    assert.equal(await db.order.count(), 2);
    const protectedRows = await db.$queryRawUnsafe(
      `SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('SalePoint','PointSale','PointEntry')`,
    );
    assert.equal(protectedRows.length, 3);
    assert.ok(protectedRows.every((r) => r.relrowsecurity));
    checks.push(
      'General all/web/manual/points source filters count exactly once; existing 51€ / 21€ manual and web results preserved; private tables enforce RLS',
    );
    await db.productCost.update({
      where: { productId: p.id },
      data: { unitCostCents: 1500 },
    });
    await db.productVariant.updateMany({
      where: { productId: p.id },
      data: { stockQty: 200 },
    });
    // Already-adjusted sales must work even when the current stock is zero.
    const adjustedPoint = await makePoint('Stock already adjusted');
    await db.productVariant.update({where:{id:variantId},data:{stockQty:0}});
    const adjustedBody = {...saleBody(0,2,2550),stockHandling:'ALREADY_ADJUSTED'};
    const adjustedKey = randomUUID();
    const adjustedEntry = await points.sale(adjustedPoint,admin.id,adjustedKey,adjustedBody);
    assert.equal((await points.sale(adjustedPoint,admin.id,adjustedKey,adjustedBody)).id,adjustedEntry.id);
    assert.equal((await db.productVariant.findUnique({where:{id:variantId}})).stockQty,0);
    assert.equal(await db.stockMovement.count({where:{note:'PointEntry:'+adjustedEntry.id}}),0);
    assert.equal((await detail(adjustedPoint)).report.totals.profitCents,2100);
    let adjustedSale=await db.pointSale.findUnique({where:{id:adjustedEntry.saleId}});
    assert.equal(adjustedSale.state.stockHandling,'ALREADY_ADJUSTED');
    let adjustment={...adjustedBody,occurredAt:'2026-10-03T12:00',revision:adjustedSale.revision,reason:'Already adjusted difference',lines:adjustedSale.state.lines.map(l=>({id:l.id,variantId:l.variantId,quantity:3,unitPriceCents:l.unitPriceCents,commissionBp:l.commissionBp}))};
    await points.sale(adjustedPoint,admin.id,randomUUID(),adjustment,adjustedSale.id);
    assert.equal((await db.productVariant.findUnique({where:{id:variantId}})).stockQty,0);
    adjustedSale=await db.pointSale.findUnique({where:{id:adjustedSale.id}});
    adjustment={...adjustment,stockHandling:'DEDUCT_NOW',revision:adjustedSale.revision,lines:adjustment.lines.map(l=>({...l,quantity:4}))};
    await assert.rejects(points.sale(adjustedPoint,admin.id,randomUUID(),adjustment,adjustedSale.id),/Stock insuficiente/);
    assert.equal((await db.pointSale.findUnique({where:{id:adjustedSale.id}})).state.lines[0].quantity,3);
    await db.productVariant.update({where:{id:variantId},data:{stockQty:2}});
    await points.sale(adjustedPoint,admin.id,randomUUID(),adjustment,adjustedSale.id);
    assert.equal((await db.productVariant.findUnique({where:{id:variantId}})).stockQty,1);
    adjustedSale=await db.pointSale.findUnique({where:{id:adjustedSale.id}});
    await points.refund(adjustedPoint,adjustedSale.id,admin.id,randomUUID(),{occurredAt:'2026-10-04T12:00',revision:adjustedSale.revision,reason:'Explicit return restocking',lines:[{id:adjustedSale.state.lines[0].id,quantity:1,restock:true,recoveredCommissionCents:0}]});
    assert.equal((await db.productVariant.findUnique({where:{id:variantId}})).stockQty,2);
    await db.productVariant.updateMany({where:{productId:p.id},data:{stockQty:200}});
    checks.push('Already-adjusted stock: zero stock allowed, no duplicate movement, accurate profit, idempotent retries; corrections adjust only chosen differences and explicit return restocking works');
    // Full application HTTP guards/validation, with test-only login on loopback.
    const isolatedCwd = path.join(root, 'test-results/sale-points/runtime');
    fs.mkdirSync(isolatedCwd, { recursive: true });
    process.chdir(isolatedCwd);
    const { NestFactory } = require('@nestjs/core'),
      { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = require('../dist/app.module');
    app = await NestFactory.create(AppModule, { logger: ['error'] });
    app.setGlobalPrefix('api');
    app.use(require('cookie-parser')());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.use((req, res, next) => {
      const token = req.cookies?.cronox_csrf_token || randomUUID();
      req.csrfToken = token;
      if (!req.cookies?.cronox_csrf_token)
        res.cookie('cronox_csrf_token', token, { sameSite: 'lax' });
      next();
    });
    const {
      AuthSessionsService,
    } = require('../dist/auth/auth-sessions.service');
    const auth = app.get(AuthSessionsService),
      token = await auth.create(admin),
      userToken = await auth.create(customer);
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' || !/^\/[a-z0-9-]+\.html$/.test(req.path))
        return next();
      try {
        const html = fs.readFileSync(
          path.join(root, 'cronox-front', req.path.slice(1)),
          'utf8',
        );
        res
          .type('html')
          .send(
            html.replace(
              '<head>',
              '<head><meta name="cronox:api-base" content="http://127.0.0.1:43121">',
            ),
          );
      } catch {
        next();
      }
    });
    app
      .getHttpAdapter()
      .getInstance()
      .get('/__review/admin', (_req, res) => {
        res.cookie('jwt', token.accessToken, {
          httpOnly: true,
          sameSite: 'lax',
        });
        res.cookie('refresh_token', token.refreshToken, {
          httpOnly: true,
          sameSite: 'lax',
        });
        res.redirect('/admin.html#section-sale-points');
      });
    await app.listen(43121, '127.0.0.1');
    for (const route of [
      '/api/admin/sale-points',
      '/api/admin/sale-points/options',
      '/api/admin/sale-points/' + id + '?from=2026-10-01&to=2026-10-31',
      '/api/admin/finance?from=2026-10-01&to=2026-10-31',
    ]) {
      assert.equal((await fetch('http://127.0.0.1:43121' + route)).status, 401);
      assert.equal(
        (
          await fetch('http://127.0.0.1:43121' + route, {
            headers: { Authorization: 'Bearer ' + userToken.accessToken },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch('http://127.0.0.1:43121' + route, {
            headers: { Authorization: 'Bearer ' + token.accessToken },
          })
        ).status,
        200,
      );
    }
    const csrf = 'local-test-csrf-token-for-sale-points';
    const send = async (path, body, access = token.accessToken) =>
      fetch('http://127.0.0.1:43121/api/admin/sale-points' + path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + access,
          Origin: 'http://127.0.0.1:43121',
          Cookie: 'cronox_csrf_token=' + csrf,
          'x-csrf-token': csrf,
          'idempotency-key': randomUUID(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    const beforeWrites = await db.pointEntry.count();
    for (const route of [
      '',
      '/' + id,
      '/' + id + '/sales',
      '/' + id + '/expenses',
      '/' + id + '/sales/' + saleId + '/correct',
      '/' + id + '/sales/' + saleId + '/returns',
    ])
      assert.equal((await send(route, {}, userToken.accessToken)).status, 403);
    assert.equal(
      (
        await send('/' + id + '/sales', {
          ...saleBody(),
          lines: [
            {
              variantId,
              quantity: -1,
              unitPriceCents: 100,
              commissionBp: 10001,
            },
          ],
        })
      ).status,
      400,
    );
    assert.equal(await db.pointEntry.count(), beforeWrites);
    for (const role of ['anon', 'authenticated'])
      if (
        (
          await db.$queryRawUnsafe(
            'SELECT 1 FROM pg_roles WHERE rolname=$1',
            role,
          )
        ).length
      )
        for (const table of ['SalePoint', 'PointSale', 'PointEntry'])
          assert.equal(
            (
              await db.$queryRawUnsafe(
                "SELECT has_table_privilege($1,$2,'SELECT') AS allowed",
                role,
                '"' + table + '"',
              )
            )[0].allowed,
            false,
          );
    checks.push(
      'Real HTTP JWT/Admin guards: anonymous 401, customer 403, administrator 200 for points, private options, detail and finance',
    );
    await require('./test-map-sale-points-fixtures.cjs')({db,points,finance,admin,customer,app,token,userToken,checks});
    fs.mkdirSync(path.join(root, 'test-results/sale-points'), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(root, 'test-results/sale-points/db-results.json'),
      JSON.stringify(
        { database: name, checks, pointId: id, passed: true },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          checks,
          pointId: id,
          passed: true,
          localUrl: 'http://127.0.0.1:43121/__review/admin',
        },
        null,
        2,
      ),
    );
    if (process.argv.includes('--serve')) {
      await new Promise((resolve) => {
        const stop = () => {
          process.stdin.removeListener('data', input);
          process.removeListener('SIGINT', stop);
          process.stdin.pause();
          resolve();
        };
        const input = (d) => { if (String(d).trim() === 'stop') stop(); };
        process.stdin.on('data', input);
        process.once('SIGINT', stop);
      });
    }
  } finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    if (created) {
      assert.match(name, /^cronox_points_test_[a-f0-9]{32}$/);
      await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await control.end();
  }
}
main().then(() => {
  // Only after awaited app/pool/database cleanup: release the review process,
  // including Windows stdin/background handles that can keep Prisma's DLL loaded.
  if (process.argv.includes('--serve')) process.exit(0);
}).catch((e) => {
  console.error(e.stack);
  if (process.argv.includes('--serve')) process.exit(1);
  process.exitCode = 1;
});
