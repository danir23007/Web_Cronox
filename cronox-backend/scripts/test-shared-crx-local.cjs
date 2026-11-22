'use strict';
require('reflect-metadata');
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
Object.assign(process.env, require('./start-local.cjs').loadLocalEnvironment());
const { PrismaClient } = require('@prisma/client');
const {
  AdminLabelsService,
} = require('../dist/admin/labels/admin-labels.service');
const {
  RegisterController,
} = require('../dist/admin/register/register.controller');
const db = new PrismaClient();
async function snapshot() {
  const state = {};
  for (const table of [
    'Product',
    'ProductVariant',
    'InventoryLot',
    'InventoryLotSlice',
    'InventoryLotAllocation',
    'StockMovement',
    'Order',
    'OrderItem',
    'PointSale',
    'PointEntry',
    'CheckoutStockReservation',
    'historial',
  ])
    state[table] = (
      await db.$queryRawUnsafe(
        `SELECT md5(COALESCE(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) hash FROM "${table}" t`,
      )
    )[0].hash;
  return state;
}
async function main() {
  const before = await snapshot(),
    labels = new AdminLabelsService(db),
    register = new RegisterController(db);
  const existing = [
    ...(await db.physicalBarcode.findMany()),
    ...(await db.physicalLotBarcode.findMany()),
  ];
  const candidates = await db.productVariant.findMany({
    where: {
      stockQty: { gte: 1 },
      isActive: true,
      product: { isActive: true, lotManaged: true },
    },
    include: {
      product: true,
      physicalBarcode: true,
      physicalLotBarcodes: true,
    },
    orderBy: { id: 'asc' },
  });
  const v = candidates.find(
    (v) =>
      !v.physicalLotBarcodes.some((b) => b.lotId === v.product.activeLotId),
  );
  assert.ok(v, 'Need an unissued combination');
  const line = { variantId: v.id, lotId: v.product.activeLotId, quantity: 1 };
  const legacy = candidates.find((v) => !v.physicalBarcode);
  assert.ok(legacy, 'Need an unissued variant');
  const results = await Promise.all(
    Array.from({ length: 16 }, (_, i) =>
      labels.generate({
        lines: i % 2 ? [line] : [{ variantId: legacy.id, quantity: 1 }],
      }),
    ),
  );
  const newCode = results[1].items[0].code,
    legacyCode = results[0].items[0].code;
  assert.match(newCode, /^CRX\d{10}$/);
  assert.match(legacyCode, /^CRX\d{10}$/);
  assert.notEqual(newCode, legacyCode);
  results.forEach((r, i) =>
    assert.equal(r.items[0].code, i % 2 ? newCode : legacyCode),
  );
  assert.equal(
    (await labels.generate({ lines: [line] })).items[0].code,
    newCode,
  );
  assert.equal((await labels.resolve(newCode)).lotId, line.lotId);
  assert.equal(
    (await register.barcode({ code: newCode }))[0].lotId,
    line.lotId,
  );
  assert.ok((await register.barcode({ code: legacyCode })).length);
  const crl = await db.physicalLotBarcode.findFirstOrThrow({
    where: {
      code: { startsWith: 'CRL' },
      variant: {
        stockQty: { gte: 1 },
        isActive: true,
        product: { isActive: true },
      },
    },
  });
  assert.equal(
    (
      await labels.generate({
        lines: [{ variantId: crl.variantId, lotId: crl.lotId, quantity: 1 }],
      })
    ).items[0].code,
    crl.code,
  );
  assert.equal(
    (await register.barcode({ code: crl.code }))[0].lotId,
    crl.lotId,
  );
  const old = candidates.find((v) => v.physicalBarcode);
  assert.ok(
    (await register.barcode({ code: old.physicalBarcode.code })).length,
  );
  assert.equal(
    await db.physicalBarcode.findUnique({ where: { code: newCode } }),
    null,
  );
  await assert.rejects(
    db.$executeRaw`INSERT INTO "PhysicalBarcode" ("code","variantId") VALUES (${newCode},NULL)`,
    (e) => e.meta?.code === '23505',
  );
  const all = [
    ...(await db.physicalBarcode.findMany()),
    ...(await db.physicalLotBarcode.findMany()),
  ];
  assert.equal(new Set(all.map((i) => i.code)).size, all.length);
  for (const issued of existing)
    assert.deepEqual(
      all.find((i) => i.code === issued.code),
      issued,
    );
  assert.deepEqual(await snapshot(), before);
  const out = path.resolve(__dirname, '../../output/playwright/shared-crx');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(
    path.join(out, 'new-crx-label.pdf'),
    await labels.pdf({ lines: [line] }),
  );
  fs.writeFileSync(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        ok: true,
        newCode,
        legacyCode,
        existingCrl: crl.code,
        variantId: v.id,
        lotId: line.lotId,
        concurrentRequests: 16,
        globalCollisionRejected: true,
        existingIdentitiesUnchanged: true,
        businessDataUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      ok: true,
      newCode,
      legacyCode,
      existingCrl: crl.code,
      concurrentRequests: 16,
      globalCollisionRejected: true,
      businessDataUnchanged: true,
    }),
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
