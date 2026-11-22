'use strict';
require('reflect-metadata');
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process'),
  { randomUUID } = require('node:crypto'),
  { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..'),
  root = path.resolve(backend, '..');
const name = 'cronox_register_test_' + randomUUID().replaceAll('-', '');
const out = path.join(root, 'output/playwright/register-confirmation');
async function main() {
  const local = loadLocalEnvironment(),
    source = new URL(local.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  const control = new Client({ connectionString: source.href });
  let created = false,
    db,
    app;
  fs.mkdirSync(out, { recursive: true });
  function tool(command, args, url) {
    const result = spawnSync(
      'C:/Program Files/PostgreSQL/17/bin/' + command + '.exe',
      args,
      {
        windowsHide: true,
        encoding: 'utf8',
        timeout: 60000,
        env: {
          ...process.env,
          PGHOST: url.hostname,
          PGPORT: url.port || '5432',
          PGUSER: decodeURIComponent(url.username),
          PGPASSWORD: decodeURIComponent(url.password),
          PGDATABASE: url.pathname.slice(1),
        },
      },
    );
    assert.equal(result.status, 0, command + ' failed: ' + result.stderr);
  }
  try {
    await control.connect();
    assert.ok(
      ['127.0.0.1', '::1'].includes(
        (await control.query('SELECT host(inet_server_addr()) host')).rows[0]
          .host,
      ),
    );
    const dump = path.join(out, 'schema-only.dump');
    tool(
      'pg_dump',
      [
        '--schema-only',
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--file',
        dump,
      ],
      source,
    );
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const target = new URL(source);
    target.pathname = '/' + name;
    tool(
      'pg_restore',
      ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', name, dump],
      target,
    );
    const sql = new Client({ connectionString: target.href });
    await sql.connect();
    if (
      !(await sql.query(`SELECT to_regclass('"RegisterSale"') present`)).rows[0]
        .present
    )
      await sql.query(
        fs.readFileSync(
          path.join(
            backend,
            'prisma/migrations/20261122160000_register_sale_confirmation/migration.sql',
          ),
          'utf8',
        ),
      );
    if(!(await sql.query(`SELECT to_regclass('"AfterSaleOperation"') present`)).rows[0].present)
      await sql.query(fs.readFileSync(path.join(backend,'prisma/migrations/20261122190000_register_after_sales/migration.sql'),'utf8'));
    await sql.query(
      'INSERT INTO "UserNumberingState"(id,"nextId",ready) VALUES(1,1,true) ON CONFLICT(id) DO UPDATE SET ready=true',
    );
    await sql.end();
    require('../test/test-environment.cjs').installTestEnvironment({
      force: true,
      overrides: {
        DATABASE_URL: target.href,
        DIRECT_URL: target.href,
        USER_NUMBERING_DATABASE_URL: target.href,
        CRONOX_ROUTE_SMOKE_MODE: 'true',
        EMAIL_ENABLED: 'false',
        BACKGROUND_JOBS_ENABLED: 'false',
        CHECKOUT_RESERVATION_WORKER_ENABLED: 'false',
        STRIPE_WEBHOOK_WORKER_ENABLED: 'false',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
        PORT: '43127',
        FRONTEND_URL: 'http://127.0.0.1:43127',
        API_PUBLIC_URL: 'http://127.0.0.1:43127',
        CORS_ORIGINS: 'http://127.0.0.1:43127',
      },
    });
    const { PrismaService } = require('../dist/prisma/prisma.service');
    db = new PrismaService();
    await db.$connect();
    assert.equal(
      (await db.$queryRawUnsafe('SELECT current_database() name'))[0].name,
      name,
    );
    const admin = await db.user.create({
      data: {
        email: 'cashier@test.invalid',
        role: 'SUPERADMIN',
        name: 'CAJA TEST',
      },
    });
    const customer = await db.user.create({
      data: { email: 'customer@test.invalid', name: 'Cliente TEST' },
    });
    const product = await db.product.create({
      data: {
        name: 'CAJA TEST - black',
        slug: 'register-test',
        price: 5000,
        privateCost: { create: { unitCostCents: 1000 } },
        variants: {
          create: { size: 'M', sku: 'REGISTER-TEST-M', stockQty: 30 },
        },
      },
      include: { variants: true },
    });
    const variant = product.variants[0],
      live = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    const lot = await db.inventoryLot.findUniqueOrThrow({
      where: { id: live.activeLotId },
    });
    const now = new Date();
    await db.inventoryLot.update({
      where: { id: lot.id },
      data: {
        webOfferPriceCents: 4000,
        webOfferPreviousCents: 5000,
        webOfferStartsAt: new Date(+now - 60000),
        webOfferEndsAt: new Date(+now + 3600000),
        webOfferConfirmedAt: now,
      },
    });
    const second = await db.inventoryLot.create({
      data: {
        id: randomUUID(),
        productId: product.id,
        name: 'Segunda tirada TEST',
        number: 2,
        profile: { ...lot.profile, price: 6000, unitCostCents: 2000 },
        costQuality: 'CONFIRMED',
        requestKey: randomUUID(),
        requestHash: 'fixture',
        slices: {
          create: {
            id: randomUUID(),
            variantId: variant.id,
            received: 10,
            available: 10,
            productionCents: 2000,
            freightCents: 0,
            otherCents: 0,
          },
        },
      },
    });
    const point = await db.salePoint.create({
      data: { name: 'EVENTO TEST', type: 'EVENT', commissionBp: 1000 },
    });
    const {
      RegisterController,
    } = require('../dist/admin/register/register.controller');
    const {
      RegisterConfirmationService,
    } = require('../dist/admin/register/register-confirmation.controller');
    const { HistorialService } = require('../dist/historial/historial.service');
    const {
      TaxConfigService,
    } = require('../dist/common/tax/tax-config.service');
    const {
      AdminFinanceService,
    } = require('../dist/admin/finance/admin-finance.service');
    const quoteService = new RegisterController(db),
      history = new HistorialService(db),
      service = new RegisterConfirmationService(
        db,
        new TaxConfigService(),
        history,
      ),
      finance = new AdminFinanceService(db);
    const payload = async (method, items, userId = null, pointId = null) => ({
      ...(await quoteService.quote({ items, userId, pointId })),
      items,
      userId,
      pointId,
      paymentMethod: method,
      key: randomUUID(),
    });
    const line = { variantId: variant.id, lotId: lot.id, quantity: 3 };
    const dto = await payload('EXTERNAL_STRIPE', [line], customer.id, point.id);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => service.confirm(dto, admin.id)),
    );
    const receipt = results[0];
    assert.ok(results.every((r) => r.orderId === receipt.orderId));
    assert.equal(receipt.totalCents, 12000);
    assert.equal(await db.order.count(), 1);
    assert.equal(await db.pointSale.count(), 1);
    assert.equal(
      await db.stockMovement.count({ where: { orderId: receipt.orderId } }),
      1,
    );
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variant.id } }))
        .stockQty,
      27,
    );
    assert.equal(
      (await history.calculatePurchaseStats(customer.id)).pedidosRealizados,
      1,
    );
    assert.equal(
      (await db.user.findUnique({ where: { id: customer.id } })).circleLevel,
      2,
    );
    assert.deepEqual(
      await service.recover(dto.key, admin.id),
      JSON.parse(JSON.stringify(receipt)),
    );
    await assert.rejects(
      service.confirm({ ...dto, paymentMethod: 'CASH' }, admin.id),
      /Clave reutilizada/,
    );
    const bizum = await service.confirm(
      await payload('BIZUM', [
        { variantId: variant.id, lotId: second.id, quantity: 1 },
      ]),
      admin.id,
    );
    assert.equal(bizum.totalCents, 6000);
    assert.equal(bizum.items[0].costCents, 2000);
    const cash = await service.confirm(
      await payload('CASH', [{ ...line, quantity: 1 }]),
      admin.id,
    );
    assert.equal(cash.customer, null);
    const stale = await payload('CASH', [{ ...line, quantity: 1 }]);
    await db.inventoryLot.update({
      where: { id: lot.id },
      data: { webOfferDisabledAt: new Date() },
    });
    await assert.rejects(
      service.confirm(stale, admin.id),
      /ticket ha cambiado/,
    );
    const stockBefore = (
      await db.productVariant.findUnique({ where: { id: variant.id } })
    ).stockQty;
    const rollback = await payload('CASH', [{ ...line, quantity: 1 }]);
    const failing = db.$extends({
      query: {
        orderItem: {
          async create() {
            throw Error('TEST_MID_TRANSACTION_FAILURE');
          },
        },
      },
    });
    const failedService = new RegisterConfirmationService(
      failing,
      new TaxConfigService(),
      history,
    );
    await assert.rejects(
      failedService.confirm(rollback, admin.id),
      /TEST_MID_TRANSACTION_FAILURE/,
    );
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variant.id } }))
        .stockQty,
      stockBefore,
    );
    assert.equal(await db.order.count(), 3);
    // Freeze costs before changing catalogue data, then confirm historical reports retain them.
    await db.productCost.update({
      where: { productId: product.id },
      data: { unitCostCents: 9999 },
    });
    const date = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Madrid',
    }).format(new Date());
    const query = {
      from: date,
      to: date,
      source: 'all',
      currency: 'EUR',
      aggregation: 'days',
      search: '',
      sort: 'revenue',
      direction: 'desc',
      page: 1,
    };
    const report = await finance.getReport(query),
      pointReport = await finance.getReport({
        ...query,
        source: 'points',
        pointId: point.id,
      });
    assert.equal(report.salesCount, 3);
    assert.equal(report.totals.revenueCents, 22000);
    assert.equal(pointReport.salesCount, 1);
    assert.equal(pointReport.totals.revenueCents, 12000);
    assert.equal(pointReport.totals.costCents, 3000);
    assert.equal(pointReport.registerPayments.reduce((n,r)=>n+r.salesCount,0),1);
    const manualReport=await finance.getReport({...query,source:'manual'});
    assert.equal(manualReport.registerPayments.reduce((n,r)=>n+r.salesCount,0),2);
    assert.equal(
      report.registerPayments.reduce((n, r) => n + r.salesCount, 0),
      3,
    );
    assert.equal(
      (await db.order.findUnique({ where: { id: receipt.orderId } })).status,
      'DELIVERED',
    );
    const { allocateLots } = require('../dist/inventory-lots/lot-ledger');
    const beforeReservation = await payload('CASH', [{ ...line, quantity: 2 }]);
    const available = (
      await db.productVariant.findUnique({ where: { id: variant.id } })
    ).stockQty;
    await db.$transaction((tx) =>
      allocateLots(
        tx,
        variant.id,
        available - 1,
        'checkout:TEST_RESERVATION',
        'RESERVED',
        lot.id,
      ),
    );
    await assert.rejects(
      service.confirm(beforeReservation, admin.id),
      /Disponibles: 1/,
    );
    const lastA = await payload('CASH', [{ ...line, quantity: 1 }]),
      lastB = await payload('BIZUM', [{ ...line, quantity: 1 }]);
    const race = await Promise.allSettled([
      service.confirm(lastA, admin.id),
      service.confirm(lastB, admin.id),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: variant.id } }))
        .stockQty,
      0,
    );
    assert.equal(await db.order.count(), 4);
    assert.equal(
      (
        await db.inventoryLotAllocation.aggregate({
          where: { sourceKey: 'checkout:TEST_RESERVATION', state: 'RESERVED' },
          _sum: { quantity: true },
        })
      )._sum.quantity,
      available - 1,
    );
    fs.writeFileSync(
      path.join(out, 'evidence.json'),
      JSON.stringify(
        {
          receipt,
          stockAfterFirstSale: 27,
          oneOrderForSixConcurrentRequests: true,
          customerStats: await history.calculatePurchaseStats(customer.id),
          general: report.totals,
          point: pointReport.totals,
          payments: report.registerPayments,
          rollback: true,
        },
        null,
        2,
      ),
    );
    const unknownProduct=await db.product.create({data:{name:'UNKNOWN COST TEST',slug:'unknown-cost-test',price:1000,variants:{create:{size:'M',sku:'UNKNOWN-TEST',stockQty:1}}},include:{variants:true}});
    const unknownLive=await db.product.findUniqueOrThrow({where:{id:unknownProduct.id}});
    const unknown=await service.confirm(await payload('CASH',[{variantId:unknownProduct.variants[0].id,lotId:unknownLive.activeLotId,quantity:1}]),admin.id);
    assert.equal(unknown.items[0].costCents,null);
    const unknownSnapshot=await db.orderItemFinancial.findFirstOrThrow({where:{item:{orderId:unknown.orderId}}});
    assert.equal(unknownSnapshot.unitCostCents,null);
    assert.ok(unknownSnapshot.lotCosts.every(p=>p.quality==='UNKNOWN'));
    // Full app with real guards, synthetic sessions and isolated database.
    const runtime = path.join(out, 'runtime');
    fs.mkdirSync(runtime, { recursive: true });
    process.chdir(runtime);
    const { NestFactory } = require('@nestjs/core'),
      { ValidationPipe } = require('@nestjs/common');
    app = await NestFactory.create(require('../dist/app.module').AppModule, {
      logger: ['error'],
    });
    app.setGlobalPrefix('api');
    app.use(require('cookie-parser')());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.use((req, res, next) => {
      const token = req.cookies?.cronox_csrf_token || randomUUID();
      req.csrfToken = token;
      if (!req.cookies?.cronox_csrf_token)
        res.cookie('cronox_csrf_token', token, { sameSite: 'lax' });
      next();
    });
    const sessions = app.get(
        require('../dist/auth/auth-sessions.service').AuthSessionsService,
      ),
      token = await sessions.create(admin),
      userToken = await sessions.create(customer);
    app.use(require('express').static(path.join(root, 'cronox-front')));
    await app.listen(43127, '127.0.0.1');
    assert.equal(
      (
        await fetch(
          'http://127.0.0.1:43127/api/admin/register/sales/' + dto.key,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(
          'http://127.0.0.1:43127/api/admin/register/sales/' + dto.key,
          { headers: { Authorization: 'Bearer ' + userToken.accessToken } },
        )
      ).status,
      403,
    );
    const { chromium, expect } = require('@playwright/test'),
      browser = await chromium.launch({ channel: 'chrome' });
    try {
      const ctx = await browser.newContext({
        viewport: { width: 1440, height: 980 },
      });
      await ctx.addCookies([
        {
          name: 'jwt',
          value: token.accessToken,
          url: 'http://127.0.0.1:43127',
          httpOnly: true,
        },
        {
          name: 'refresh_token',
          value: token.refreshToken,
          url: 'http://127.0.0.1:43127',
          httpOnly: true,
        },
      ]);
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.__CRONOX_BACKEND_PORT__ = '43127';
      });
      await page.goto('http://127.0.0.1:43127/admin.html#section-register');
      const rootEl = page.locator('#section-register'),
        act = (x) => rootEl.locator('[data-act="' + x + '"]');
      const beforeCancellation = { orders: await db.order.count(), operations: await db.afterSaleOperation.count(), movements: await db.stockMovement.count() };
      await require('./register-cancellation-browser.cjs')(page, customer, out);
      assert.deepEqual({ orders: await db.order.count(), operations: await db.afterSaleOperation.count(), movements: await db.stockMovement.count() }, beforeCancellation);
      await act('purchase').click();
      await act('no-event').click();
      await act('guest').click();
      await act('manual').click();
      const card = rootEl.locator('details').first();
      await card.locator('summary').click();
      await card.getByRole('button', { name: 'Añadir', exact: true }).click();
      await expect(rootEl.locator('aside footer')).toContainText('1 uds.');
      await expect(act('paid')).toBeDisabled();
      await rootEl.locator('[name=register-payment][value=CASH]').check();
      await expect(act('paid')).toBeEnabled();
      const prepared = await rootEl.locator('aside').innerHTML();
      await act('reset').click();
      await rootEl.locator('[data-cancel-dialog]').getByRole('button', {name:'Seguir',exact:true}).click();
      assert.equal(await rootEl.locator('aside').innerHTML(), prepared);
      const startCount = await db.order.count();
      let dropped = false;
      await page.route('**/api/admin/register/sales', async (route) => {
        const response = await route.fetch();
        assert.ok(response.ok());
        dropped = true;
        await route.abort();
      });
      await act('paid').click();
      await expect(act('recover-sale')).toBeVisible();
      assert.ok(dropped);
      await expect(rootEl.locator('[data-act=reset]')).toBeDisabled();
      assert.ok(await page.evaluate(() => sessionStorage.getItem('cronox.register.pending')));
      await act('recover-sale').click();
      await expect(rootEl.locator('aside')).toContainText('VENTA REGISTRADA');
      assert.equal(await db.order.count(), startCount + 1);
      await expect(act('reset')).toHaveText('Volver al inicio');
      await rootEl.screenshot({
        path: path.join(out, 'registered-desktop.png'),
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await rootEl.screenshot({
        path: path.join(out, 'registered-mobile.png'),
      });
      assert.ok(
        await rootEl.evaluate(
          (el) => el.getBoundingClientRect().right <= innerWidth + 1,
        ),
      );
      await act('reset').click();
      await expect(act('purchase')).toBeVisible();
      await expect(act('reset')).toBeHidden();
      await expect(rootEl.locator('[data-cancel-dialog]')).not.toBeVisible();
      assert.equal(await db.order.count(), startCount + 1);
    } finally {
      await browser.close();
    }
    console.log(
      JSON.stringify({
        ok: true,
        isolatedDatabase: name,
        methods: 3,
        concurrentRequests: 6,
        singleOrder: receipt.orderId,
        rollback: true,
        lastUnitRace: true,
        reservedUnitsPreserved: true,
        responseLossRecovered: true,
        realCharges: false,
        realEmails: false,
      }),
    );
  } finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    if (created) {
      assert.match(name, /^cronox_register_test_[a-f0-9]{32}$/);
      await control.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',
        [name],
      );
      await control.query(`DROP DATABASE "${name}"`);
    }
    await control.end();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
