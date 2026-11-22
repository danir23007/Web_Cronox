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
const name = 'cronox_after_sales_test_' + randomUUID().replaceAll('-', '');
const out = path.join(root, 'output/playwright/register-after-sales');
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
    if (
      !(await sql.query(`SELECT to_regclass('"AfterSaleOperation"') present`))
        .rows[0].present
    )
      await sql.query(
        fs.readFileSync(
          path.join(
            backend,
            'prisma/migrations/20261122190000_register_after_sales/migration.sql',
          ),
          'utf8',
        ),
      );
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
          create: [
            { size: 'M', sku: 'REGISTER-TEST-M', stockQty: 30 },
            { size: 'L', sku: 'REGISTER-TEST-L', stockQty: 10 },
            { size: 'XL', sku: 'REGISTER-TEST-XL', stockQty: 5 },
          ],
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
    const medium = product.variants.find((v) => v.size === 'M'),
      large = product.variants.find((v) => v.size === 'L'),
      extra = product.variants.find((v) => v.size === 'XL');
    await db.inventoryLotSlice.updateMany({
      where: { lotId: lot.id, variantId: large.id },
      data: { productionCents: 1200, freightCents: 0, otherCents: 0 },
    });
    const {
      AfterSalesService,
    } = require('../dist/admin/register/after-sales.controller');
    const {
      AdminLabelsService,
    } = require('../dist/admin/labels/admin-labels.service');
    const after = new AfterSalesService(db, history),
      labels = new AdminLabelsService(db);
    const codes = await labels.generate({
      lines: [medium, large, extra].map((v) => ({
        variantId: v.id,
        lotId: lot.id,
        quantity: 1,
      })),
    });
    const code = (id) => codes.items.find((c) => c.variantId === id).code;
    const original = await service.confirm(
      await payload(
        'CASH',
        [{ variantId: medium.id, lotId: lot.id, quantity: 3 }],
        customer.id,
        point.id,
      ),
      admin.id,
    );
    const orderId = original.orderId;
    const detail = () => after.detail(orderId, customer.id);
    const unitRef = (u) => ({
      itemId: u.itemId,
      ordinal: u.ordinal,
      version: u.version,
    });
    const operation = async (kind, units, restock = true, more = {}) => {
      const dto = {
        kind,
        userId: customer.id,
        orderId,
        units,
        restock,
        reason: restock ? '' : 'Sin etiqueta, prenda destinada a no vendible',
        paymentMethod: kind === 'RETURN' ? 'CASH' : undefined,
        ...more,
      };
      const prepared = await after.preview(dto);
      return {
        ...dto,
        revision: prepared.revision,
        key: randomUUID(),
        externalDone: kind === 'RETURN',
      };
    };
    let d = await detail(),
      u = d.units[0];
    assert.equal(u.color, 'BLACK');
    const ex1 = await operation('EXCHANGE', [
      {
        ...unitRef(u),
        incomingCode: code(medium.id),
        outgoingCode: code(large.id),
      },
    ]);
    const settled = await Promise.allSettled(
      Array.from({ length: 6 }, () => after.confirm(ex1, admin.id)),
    );
    const failed = settled.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    const concurrent = settled.map((r) => r.value);
    assert.ok(concurrent.every((r) => r.key === ex1.key));
    assert.equal(await db.afterSaleOperation.count(), 1);
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: medium.id } }))
        .stockQty,
      28,
    );
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: large.id } }))
        .stockQty,
      9,
    );
    d = await detail();
    u = d.units[0];
    assert.equal(u.variantId, large.id);
    assert.equal(u.valueCents, 4000);
    assert.equal(
      (await db.orderItem.findUnique({ where: { id: u.itemId } })).variantId,
      medium.id,
    );
    const ex2 = await operation('EXCHANGE', [
      {
        ...unitRef(u),
        incomingCode: code(large.id),
        outgoingCode: code(extra.id),
      },
    ]);
    await after.confirm(ex2, admin.id);
    d = await detail();
    u = d.units[0];
    assert.equal(u.variantId, extra.id);
    const noStockBefore = (
      await db.productVariant.findUnique({ where: { id: extra.id } })
    ).stockQty;
    const bad = await operation('RETURN', [unitRef(u)], false);
    await after.confirm(bad, admin.id);
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: extra.id } }))
        .stockQty,
      noStockBefore,
    );
    d = await detail();
    assert.equal(d.units[0].state, 'RETURNED');
    await assert.rejects(
      after.confirm({ ...bad, key: randomUUID() }, admin.id),
      /unidad|actualiza/i,
    );
    const good = await operation('RETURN', [unitRef(d.units[1])]);
    const replies = await Promise.all(
      Array.from({ length: 4 }, () => after.confirm(good, admin.id)),
    );
    assert.ok(replies.every((r) => r.key === good.key));
    d = await detail();
    const lastA = await operation('RETURN', [unitRef(d.units[2])]);
    const lastB = { ...lastA, key: randomUUID() };
    const race = await Promise.allSettled([
      after.confirm(lastA, admin.id),
      after.confirm(lastB, admin.id),
    ]);
    assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      (
        await db.afterSaleOperation.aggregate({
          where: { orderId },
          _sum: { refundCents: true },
        })
      )._sum.refundCents,
      12000,
    );
    const stats = await history.calculatePurchaseStats(customer.id);
    assert.equal(stats.pedidosRealizados, 1);
    assert.equal(stats.articulosAdquiridos, 0);
    assert.equal(stats.devoluciones, 3);
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
    assert.equal(report.salesCount, 1);
    assert.equal(report.totals.revenueCents, 0);
    assert.equal(report.totals.costCents, 1000);
    assert.equal(report.totals.profitCents, -2200);
    assert.equal(pointReport.totals.revenueCents, 0);
    assert.equal(pointReport.totals.unitsReturned, 3);
    const historyOrder = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    assert.equal(historyOrder.items[0].quantity, 3);
    assert.equal(historyOrder.status, 'DELIVERED');
    fs.writeFileSync(
      path.join(out, 'physical-evidence.json'),
      JSON.stringify(
        {
          original,
          history: (await detail()).history,
          stats,
          general: report.totals,
          point: pointReport.totals,
          concurrencySingleOperation: true,
          inventory: await db.productVariant.findMany({
            where: { productId: product.id },
            select: { id: true, size: true, stockQty: true },
          }),
        },
        null,
        2,
      ),
    );
    // Online order with a one-cent order discount and shipping, preserving all original rows.
    const online = await service.confirm(
      await payload(
        'CASH',
        [{ variantId: medium.id, lotId: lot.id, quantity: 3 }],
        customer.id,
      ),
      admin.id,
    );
    await db.order.update({
      where: { id: online.orderId },
      data: {
        source: 'ONLINE',
        provider: 'stripe',
        providerRef: 'pi_after_sale_test',
        discountCents: 1,
        shippingCost: 100,
        total: '120.99',
        taxAmount: '21.00',
      },
    });
    const onlineDetail = await after.detail(online.orderId, customer.id);
    assert.deepEqual(
      onlineDetail.units.map((u) => u.valueCents),
      [4000, 4000, 3999],
    );
    const refundDto = {
      kind: 'RETURN',
      orderId: online.orderId,
      userId: customer.id,
      units: onlineDetail.units.map(unitRef),
      restock: true,
      reason: '',
      paymentMethod: 'EXTERNAL_STRIPE',
      externalReference: 're_afterSaleTest',
    };
    const preview = await after.preview(refundDto);
    assert.equal(preview.refundCents, 11999);
    await after.confirm(
      {
        ...refundDto,
        key: randomUUID(),
        revision: preview.revision,
        externalDone: true,
      },
      admin.id,
    );
    await db.stripeWebhookEvent.create({
      data: {
        id: 'evt_after_sale_test',
        type: 'charge.refunded',
        paymentIntentId: 'pi_after_sale_test',
        refundCumulativeCents: 11999,
        status: 'PROCESSED',
        occurredAt: new Date(),
        payload: {
          data: {
            object: {
              amount_refunded: 11999,
              refunds: {
                has_more: false,
                data: [
                  {
                    id: 're_afterSaleTest',
                    status: 'succeeded',
                    amount: 11999,
                  },
                ],
              },
            },
          },
        },
      },
    });
    const onlineReport = await finance.getReport({ ...query, source: 'web' });
    assert.equal(onlineReport.totals.revenueCents, 0);
    assert.equal(onlineReport.totals.costCents, 0);
    assert.equal(
      (await db.orderItem.findFirst({ where: { orderId: online.orderId } }))
        .quantity,
      3,
    );
    // A fresh purchase for rollback and interactive verification.
    const uiSale = await service.confirm(
      await payload(
        'CASH',
        [{ variantId: medium.id, lotId: lot.id, quantity: 2 }],
        customer.id,
      ),
      admin.id,
    );
    const uiDetail = await after.detail(uiSale.orderId, customer.id),
      ref = unitRef(uiDetail.units[0]);
    const revertDto = {
      kind: 'RETURN',
      orderId: uiSale.orderId,
      userId: customer.id,
      units: [ref],
      restock: true,
      reason: '',
      paymentMethod: 'CASH',
    };
    const revertPreview = await after.preview(revertDto),
      beforeStock = (
        await db.productVariant.findUnique({ where: { id: medium.id } })
      ).stockQty;
    const failing = db.$extends({
      query: {
        afterSaleUnit: {
          async upsert() {
            throw Error('AFTER_SALE_TEST_ROLLBACK');
          },
        },
      },
    });
    await assert.rejects(
      new AfterSalesService(failing, history).confirm(
        {
          ...revertDto,
          key: randomUUID(),
          revision: revertPreview.revision,
          externalDone: true,
        },
        admin.id,
      ),
      /AFTER_SALE_TEST_ROLLBACK/,
    );
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: medium.id } }))
        .stockQty,
      beforeStock,
    );
    await assert.rejects(
      after.scan({
        userId: customer.id,
        orderId: uiSale.orderId,
        ...ref,
        direction: 'IN',
        code: code(large.id),
      }),
      /talla/,
    );
    await assert.rejects(
      after.preview({
        ...revertDto,
        kind: 'EXCHANGE',
        units: [
          {
            ...ref,
            incomingCode: code(medium.id),
            outgoingCode: code(medium.id),
          },
        ],
      }),
      /diferente/,
    );
    const legacyCode = (
      await labels.generate({ lines: [{ variantId: medium.id, quantity: 1 }] })
    ).items[0].code;
    await assert.rejects(
      after.scan({
        userId: customer.id,
        orderId: uiSale.orderId,
        ...ref,
        direction: 'IN',
        code: legacyCode,
      }),
      /antiguo|inequívoca/,
    );
    const wrongLot = (
      await labels.generate({
        lines: [{ variantId: medium.id, lotId: second.id, quantity: 1 }],
      })
    ).items[0].code;
    await assert.rejects(
      after.scan({
        userId: customer.id,
        orderId: uiSale.orderId,
        ...ref,
        direction: 'IN',
        code: wrongLot,
      }),
      /lote/,
    );
    const {
      allocateLots,
      returnLots,
    } = require('../dist/inventory-lots/lot-ledger');
    const availableL = (
      await db.productVariant.findUnique({ where: { id: large.id } })
    ).stockQty;
    await db.$transaction((tx) =>
      allocateLots(
        tx,
        large.id,
        availableL,
        'checkout:AFTER_SALE_RESERVED',
        'RESERVED',
        lot.id,
      ),
    );
    await assert.rejects(
      after.scan({
        userId: customer.id,
        orderId: uiSale.orderId,
        ...ref,
        direction: 'OUT',
        code: code(large.id),
      }),
      /stock/,
    );
    await db.$transaction((tx) =>
      returnLots(
        tx,
        large.id,
        availableL,
        'checkout:AFTER_SALE_RESERVED',
        true,
      ),
    );
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: large.id } }))
        .stockQty,
      availableL,
    );
    assert.equal(
      (
        await db.afterSaleOperation.aggregate({
          where: { orderId },
          _sum: { taxCents: true },
        })
      )._sum.taxCents,
      2083,
    );
    const queued = await service.confirm(
      await payload(
        'CASH',
        [{ variantId: medium.id, lotId: lot.id, quantity: 2 }],
        customer.id,
      ),
      admin.id,
    );
    const queuedDetail = await after.detail(queued.orderId, customer.id);
    const queueDto = {
      kind: 'EXCHANGE',
      orderId: queued.orderId,
      userId: customer.id,
      units: queuedDetail.units.map((u) => ({
        ...unitRef(u),
        incomingCode: code(medium.id),
        outgoingCode: code(large.id),
      })),
      restock: true,
      reason: '',
    };
    const queuePreview = await after.preview(queueDto),
      ordersBeforeQueue = await db.order.count();
    await after.confirm(
      {
        ...queueDto,
        revision: queuePreview.revision,
        key: randomUUID(),
        externalDone: false,
      },
      admin.id,
    );
    assert.equal(await db.order.count(), ordersBeforeQueue);
    assert.ok(
      (await after.detail(queued.orderId, customer.id)).units.every(
        (u) => u.variantId === large.id && u.valueCents === 4000,
      ),
    );
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: large.id } }))
        .stockQty,
      availableL - 2,
    );
    await db.order.createMany({
      data: Array.from({ length: 21 }, (_, i) => ({
        userId: customer.id,
        customerEmail: customer.email,
        status: 'PENDING',
        source: 'ONLINE',
        subtotal: 0,
        total: 0,
        taxRate: '0.21',
        taxAmount: 0,
        createdAt: new Date(Date.UTC(2020, 0, i + 1)),
      })),
    });
    const firstHistory = await after.historyFor(customer.id, 1),
      secondHistory = await after.historyFor(customer.id, 2);
    assert.ok(firstHistory.more && secondHistory.items.length > 0);
    assert.ok(
      firstHistory.items.some((o) => o.source === 'ONLINE') &&
        firstHistory.items.some((o) => o.source === 'IN_PERSON_ADMIN'),
    );
    const dates = firstHistory.items.map(
      (o) => +(o.purchasedAt ?? o.createdAt),
    );
    assert.ok(dates.every((d, i) => i === 0 || dates[i - 1] >= d));
    await assert.rejects(after.detail(orderId, admin.id), /pertenece/);
    const pendingOrder = await db.order.findFirstOrThrow({
      where: { userId: customer.id, status: 'PENDING' },
    });
    await assert.rejects(
      after.preview({ ...revertDto, orderId: pendingOrder.id }),
      /estado actual/,
    );
    const ambiguous = await service.confirm(
      await payload(
        'CASH',
        [{ variantId: medium.id, lotId: lot.id, quantity: 1 }],
        customer.id,
      ),
      admin.id,
    );
    await db.order.update({
      where: { id: ambiguous.orderId },
      data: {
        source: 'ONLINE',
        provider: 'stripe',
        providerRef: 'pi_ambiguous_test',
      },
    });
    const ambiguousDetail = await after.detail(ambiguous.orderId, customer.id);
    await db.stripeWebhookEvent.create({
      data: {
        id: 'evt_ambiguous_test',
        type: 'charge.refunded',
        paymentIntentId: 'pi_ambiguous_test',
        status: 'PENDING',
        refundCumulativeCents: 2000,
        occurredAt: new Date(),
        payload: {
          data: {
            object: {
              amount_refunded: 2000,
              refunds: {
                has_more: false,
                data: [
                  { id: 're_ambiguousTest', amount: 2000, status: 'pending' },
                ],
              },
            },
          },
        },
      },
    });
    await assert.rejects(
      after.preview({
        kind: 'RETURN',
        userId: customer.id,
        orderId: ambiguous.orderId,
        units: ambiguousDetail.units.map(unitRef),
        restock: true,
        reason: '',
        paymentMethod: 'EXTERNAL_STRIPE',
        externalReference: 're_ambiguousTest',
      }),
      /pendiente|conciliar/,
    );
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
    const full = await service.confirm(
      await payload(
        'CASH',
        [{ variantId: medium.id, lotId: lot.id, quantity: 1 }],
        customer.id,
      ),
      admin.id,
    );
    await db.order.update({
      where: { id: full.orderId },
      data: {
        source: 'ONLINE',
        provider: 'stripe',
        providerRef: 'pi_after_sale_full',
      },
    });
    const fullDetail = await after.detail(full.orderId, customer.id);
    const fullDto = {
      kind: 'RETURN',
      orderId: full.orderId,
      userId: customer.id,
      units: fullDetail.units.map(unitRef),
      restock: true,
      reason: '',
      paymentMethod: 'EXTERNAL_STRIPE',
      externalReference: 're_afterSaleFull',
    };
    const fullPreview = await after.preview(fullDto);
    await after.confirm(
      {
        ...fullDto,
        revision: fullPreview.revision,
        key: randomUUID(),
        externalDone: true,
      },
      admin.id,
    );
    const beforeWebhook = (
      await db.productVariant.findUnique({ where: { id: medium.id } })
    ).stockQty;
    await db.stripeWebhookEvent.create({
      data: {
        id: 'evt_after_sale_full',
        type: 'charge.refunded',
        paymentIntentId: 'pi_after_sale_full',
        lifecycleStatus: 'REFUNDED',
        refundCumulativeCents: 4000,
        status: 'PROCESSED',
        occurredAt: new Date(),
        payload: {
          data: {
            object: {
              amount_refunded: 4000,
              refunds: {
                has_more: false,
                data: [
                  { id: 're_afterSaleFull', status: 'succeeded', amount: 4000 },
                ],
              },
            },
          },
        },
      },
    });
    await app
      .get(require('../dist/orders/orders.service').OrdersService)
      .reconcileStripePaymentLifecycle('pi_after_sale_full');
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: medium.id } }))
        .stockQty,
      beforeWebhook,
    );
    const meOrders = await app
      .get(require('../dist/me/me.service').MeService)
      .getOrders(customer.id);
    assert.ok(meOrders.find((o) => o.id === orderId).afterSales.length >= 5);
    assert.deepEqual(meOrders.find((o) => o.id === orderId).purchaseUnits, {
      bought: 3,
      returned: 3,
      held: 0,
    });
    const guestSale = await service.confirm(
      await payload('CASH', [
        { variantId: medium.id, lotId: lot.id, quantity: 1 },
      ]),
      admin.id,
    );
    await assert.rejects(
      after.detail(guestSale.orderId, customer.id),
      /pertenece/,
    );
    assert.equal(
      (
        await fetch(
          'http://127.0.0.1:43127/api/admin/register/after-sales/orders/' +
            orderId +
            '?userId=' +
            customer.id,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await fetch(
          'http://127.0.0.1:43127/api/admin/register/after-sales/orders/' +
            orderId +
            '?userId=' +
            customer.id,
          { headers: { Authorization: 'Bearer ' + userToken.accessToken } },
        )
      ).status,
      403,
    );
    const reviewSale = await service.confirm(
      await payload(
        'CASH',
        [{ variantId: medium.id, lotId: lot.id, quantity: 1 }],
        customer.id,
      ),
      admin.id,
    );
    let reviewDetail = await after.detail(reviewSale.orderId, customer.id);
    const reviewExchange = {
      kind: 'EXCHANGE',
      orderId: reviewSale.orderId,
      userId: customer.id,
      units: reviewDetail.units.map((u) => ({
        ...unitRef(u),
        incomingCode: code(medium.id),
        outgoingCode: code(large.id),
      })),
      restock: true,
      reason: '',
    };
    const reviewExchangePreview = await after.preview(reviewExchange);
    await after.confirm(
      {
        ...reviewExchange,
        key: randomUUID(),
        revision: reviewExchangePreview.revision,
        externalDone: false,
      },
      admin.id,
    );
    await db.order.update({
      where: { id: reviewSale.orderId },
      data: {
        source: 'ONLINE',
        provider: 'stripe',
        providerRef: 'pi_after_sale_review',
      },
    });
    await db.stripeWebhookEvent.create({
      data: {
        id: 'evt_after_sale_review',
        type: 'charge.refunded',
        paymentIntentId: 'pi_after_sale_review',
        lifecycleStatus: 'REFUNDED',
        refundCumulativeCents: 4000,
        status: 'REVIEW',
        error: 'AFTER_SALE_REFUND_RECONCILIATION_REQUIRED',
        occurredAt: new Date(),
        payload: {
          data: {
            object: {
              amount_refunded: 4000,
              refunds: {
                has_more: false,
                data: [
                  {
                    id: 're_afterSaleReview',
                    status: 'succeeded',
                    amount: 4000,
                  },
                ],
              },
            },
          },
        },
      },
    });
    reviewDetail = await after.detail(reviewSale.orderId, customer.id);
    const reconcileDto = {
      kind: 'RETURN',
      orderId: reviewSale.orderId,
      userId: customer.id,
      units: reviewDetail.units.map(unitRef),
      restock: true,
      reason: '',
      paymentMethod: 'EXTERNAL_STRIPE',
      externalReference: 're_afterSaleReview',
    };
    const reconcilePreview = await after.preview(reconcileDto);
    await after.confirm(
      {
        ...reconcileDto,
        key: randomUUID(),
        revision: reconcilePreview.revision,
        externalDone: true,
      },
      admin.id,
    );
    assert.equal(
      (
        await db.stripeWebhookEvent.findUnique({
          where: { id: 'evt_after_sale_review' },
        })
      ).status,
      'PENDING',
    );
    const afterReviewStock = (
      await db.productVariant.findUnique({ where: { id: large.id } })
    ).stockQty;
    await app
      .get(require('../dist/orders/orders.service').OrdersService)
      .reconcileStripePaymentLifecycle('pi_after_sale_review');
    assert.equal(
      (await db.productVariant.findUnique({ where: { id: large.id } }))
        .stockQty,
      afterReviewStock,
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
      const as = (action) => rootEl.locator('[data-as="' + action + '"]');
      // Cancellation of an identified preparation clears its queue and ignores late history responses.
      const unchanged = { operations: await db.afterSaleOperation.count(), movements: await db.stockMovement.count() };
      for (const action of ['refund', 'exchange']) {
        await act(action).click();
        await rootEl.locator('input[name=code]').fill(customer.email);
        await rootEl.locator('input[name=code]').press('Enter');
        await rootEl.locator('[data-as=order][data-id="' + uiSale.orderId + '"]').click();
        await rootEl.locator('[data-as-unit="' + ref.itemId + ':0"]').check();
        const selectedTicket = await rootEl.locator('aside').innerHTML();
        await act('reset').click();
        await rootEl.locator('[data-cancel-dialog]').getByRole('button', {name:'Seguir',exact:true}).click();
        assert.equal(await rootEl.locator('aside').innerHTML(), selectedTicket);
        assert.equal(await rootEl.locator('[data-as-unit]:checked').count(), 1);
        let release, entered;
        const gate = new Promise(resolve => release = resolve);
        const started = new Promise(resolve => entered = resolve);
        await page.route('**/api/admin/register/after-sales/orders?*', async route => {
          const response = await route.fetch(); entered(); await gate;
          await route.fulfill({response}).catch(() => {});
        });
        await as('history').click();
        await started;
        await expect(act('reset')).toBeEnabled();
        await act('reset').click();
        await rootEl.locator('[data-cancel-confirm]').click();
        release();
        await page.unroute('**/api/admin/register/after-sales/orders?*');
        await expect(act('purchase')).toBeVisible();
        await expect(act('reset')).toBeHidden();
        await page.waitForTimeout(100);
        await expect(act('purchase')).toBeVisible();
        await expect(rootEl.locator('aside')).toBeHidden();
      }
      assert.deepEqual({ operations: await db.afterSaleOperation.count(), movements: await db.stockMovement.count() }, unchanged);
      await act('exchange').click();
      await rootEl.locator('input[name=code]').fill(customer.email);
      await rootEl.locator('input[name=code]').press('Enter');
      await rootEl
        .locator('[data-as=order][data-id="' + uiSale.orderId + '"]')
        .click();
      await rootEl.locator('[data-as-unit="' + ref.itemId + ':0"]').check();
      await as('scan').click();
      const enterCode = async (value) => {
        const input = rootEl.locator('[data-as-form=scan] input');
        await input.fill(value);
        await input.press('Enter');
      };
      await enterCode(code(large.id));
      await expect(rootEl.locator('#register-feedback')).toContainText('talla');
      await expect(rootEl.locator('#register-work h3').last()).toContainText(
        '1.',
      );
      await enterCode(code(medium.id));
      await expect(rootEl.locator('#register-work h3').last()).toContainText(
        '2.',
      );
      await enterCode(code(medium.id));
      await expect(rootEl.locator('#register-feedback')).toContainText(
        'diferente',
      );
      await enterCode(code(large.id));
      await expect(
        rootEl.locator('[data-as-field=condition]'),
      ).not.toBeChecked();
      await rootEl.locator('[data-as-field=condition]').check();
      await as('preview').click();
      await expect(as('confirm')).toBeEnabled();
      const opCount = await db.afterSaleOperation.count();
      let dropped = false;
      await page.route(
        '**/api/admin/register/after-sales/confirm',
        async (route) => {
          const response = await route.fetch();
          assert.ok(response.ok());
          dropped = true;
          await route.abort();
        },
      );
      await as('confirm').click();
      await expect(as('recover')).toBeVisible();
      assert.ok(dropped);
      await expect(act('reset')).toBeDisabled();
      assert.ok(await page.evaluate(() => sessionStorage.getItem('cronox.register.after-sale.pending')));
      await as('recover').click();
      await expect(rootEl.locator('aside')).toContainText('CAMBIO REGISTRADO');
      await expect(act('reset')).toHaveText('Volver al inicio');
      assert.equal(await db.afterSaleOperation.count(), opCount + 1);
      await rootEl.screenshot({ path: path.join(out, 'exchange-desktop.png') });
      await page.unroute('**/api/admin/register/after-sales/confirm');
      await act('reset').click();
      await act('refund').click();
      await rootEl.locator('input[name=code]').fill(customer.email);
      await rootEl.locator('input[name=code]').press('Enter');
      await rootEl
        .locator('[data-as=order][data-id="' + uiSale.orderId + '"]')
        .click();
      await rootEl.locator('[data-as-unit="' + ref.itemId + ':0"]').check();
      await rootEl.locator('[data-as-field=condition]').check();
      await rootEl.locator('[data-as-field=method]').selectOption('CASH');
      await as('preview').click();
      await expect(as('confirm')).toBeDisabled();
      await rootEl.locator('[data-as-field=externalDone]').check();
      await expect(as('confirm')).toBeEnabled();
      await as('confirm').click();
      await expect(rootEl.locator('aside')).toContainText('REGISTRADA');
      await expect(act('reset')).toHaveText('Volver al inicio');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      await rootEl.screenshot({ path: path.join(out, 'return-mobile.png') });
      assert.ok(
        await rootEl.evaluate(
          (el) =>
            el.getBoundingClientRect().right <= innerWidth + 1 &&
            el.getBoundingClientRect().left >= -1,
        ),
      );
      const final = await after.detail(uiSale.orderId, customer.id);
      assert.equal(final.units[0].state, 'RETURNED');
      assert.equal(final.units[0].variantId, large.id);
      const completedCount = await db.afterSaleOperation.count();
      await act('reset').click();
      await expect(act('purchase')).toBeVisible();
      await expect(act('reset')).toBeHidden();
      await expect(rootEl.locator('[data-cancel-dialog]')).not.toBeVisible();
      assert.equal(await db.afterSaleOperation.count(), completedCount);
    } finally {
      await browser.close();
    }
    console.log(
      JSON.stringify({
        ok: true,
        isolatedDatabase: name,
        concurrentRequests: 6,
        originalOrderId: orderId,
        exchangeQueueUnits: 2,
        paginatedHistory: true,
        rollback: true,
        sameUnitRace: true,
        reservedUnitsPreserved: true,
        webhookReconciledWithoutSecondRestock: true,
        responseLossRecovered: true,
        realCharges: false,
        realEmails: false,
      }),
    );
  } finally {
    if (app) await app.close();
    if (db) await db.$disconnect();
    if (created) {
      assert.match(name, /^cronox_after_sales_test_[a-f0-9]{32}$/);
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
