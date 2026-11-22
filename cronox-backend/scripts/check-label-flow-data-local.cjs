'use strict';
// Read-only snapshots around browser QA; never starts the application or changes business data.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { loadLocalEnvironment } = require('./start-local.cjs');
Object.assign(process.env, loadLocalEnvironment());
const { PrismaClient } = require('@prisma/client');
async function main() {
  const db = new PrismaClient(),
    out = path.resolve(__dirname, '../../output/playwright/labels-flow');
  try {
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(
        new URL(process.env.DATABASE_URL).hostname,
      ),
    );
    const result = {};
    for (const table of [
      'Product',
      'ProductVariant',
      'Order',
      'OrderItem',
      'InventoryLot',
      'InventoryLotSlice',
      'LabelTemplateSettings',
    ])
      result[table] = (
        await db.$queryRawUnsafe(
          `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) AS hash FROM "${table}" t`,
        )
      )[0].hash;
    result.identities = await db.physicalBarcode.findMany({
      orderBy: { code: 'asc' },
    });
    fs.mkdirSync(out, { recursive: true });
    if (process.argv.includes('--after')) {
      const before = JSON.parse(
        fs.readFileSync(path.join(out, 'data-before.json'), 'utf8'),
      );
      for (const key of Object.keys(result).filter((k) => k !== 'identities'))
        assert.equal(result[key], before[key], key + ' changed');
      for (const identity of before.identities)
        assert.deepEqual(
          JSON.parse(
            JSON.stringify(
              result.identities.find((row) => row.code === identity.code),
            ),
          ),
          identity,
        );
      const report = {
        ok: true,
        catalogueStockOrdersLotsAndTemplatesUnchanged: true,
        existingCodesUnchanged: true,
        explicitlyIssuedMissingCodes:
          result.identities.length - before.identities.length,
      };
      fs.writeFileSync(
        path.join(out, 'data-report.json'),
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(report));
    } else {
      fs.writeFileSync(
        path.join(out, 'data-before.json'),
        JSON.stringify(result),
      );
      console.log('Read-only local snapshot saved.');
    }
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
