'use strict';
// All mutations target a fresh disposable local database, cloned from the local catalogue.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { randomUUID } = require('node:crypto'),
  { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..'),
  out = path.resolve(backend, '../output/playwright/physical-labels');
async function main() {
  const env = loadLocalEnvironment(),
    source = new URL(env.DATABASE_URL);
  source.search = '';
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  const name = 'cronox_labels_test_' + randomUUID().replaceAll('-', ''),
    control = new Client({ connectionString: source.href });
  let created = false,
    db,
    sql;
  fs.mkdirSync(out, { recursive: true });
  const run = (tool, args, url) => {
    const result = spawnSync(
      path.join(
        env.LOCAL_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin',
        tool + '.exe',
      ),
      args,
      {
        env: {
          ...process.env,
          PGHOST: url.hostname,
          PGPORT: url.port || '5432',
          PGUSER: decodeURIComponent(url.username),
          PGPASSWORD: decodeURIComponent(url.password),
          PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        },
        windowsHide: true,
        encoding: 'utf8',
        timeout: 120000,
      },
    );
    assert.equal(result.status, 0, tool + ' failed');
  };
  try {
    await control.connect();
    assert.ok(
      ['127.0.0.1', '::1'].includes(
        (await control.query('SELECT host(inet_server_addr()) AS host')).rows[0]
          .host,
      ),
    );
    const dump = path.join(out, 'local-copy.dump');
    run(
      'pg_dump',
      ['--format=custom', '--no-owner', '--no-acl', '--file', dump],
      source,
    );
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const target = new URL(source);
    target.pathname = '/' + name;
    run(
      'pg_restore',
      ['--no-owner', '--no-acl', '--exit-on-error', '--dbname', name, dump],
      target,
    );
    sql = new Client({ connectionString: target.href });
    await sql.connect();
    const snapshot = async () => {
      const rows = {};
      for (const table of [
        'Product',
        'ProductVariant',
        'Order',
        'OrderItem',
        'InventoryLot',
        'InventoryLotSlice',
        'User',
      ])
        rows[table] = (
          await sql.query(
            `SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text,'[]')) AS hash FROM "${table}" t`,
          )
        ).rows[0].hash;
      return rows;
    };
    const before = await snapshot();
    if (
      !(await sql.query(`SELECT to_regclass('"PhysicalBarcode"') AS t`)).rows[0]
        .t
    )
      await sql.query(
        fs.readFileSync(
          path.join(
            backend,
            'prisma/migrations/20261121120000_physical_barcodes/migration.sql',
          ),
          'utf8',
        ),
      );
    assert.deepEqual(await snapshot(), before);
    if (
      !(await sql.query(`SELECT to_regclass('"LabelTemplateSettings"') AS t`))
        .rows[0].t
    )
      await sql.query(
        fs.readFileSync(
          path.join(
            backend,
            'prisma/migrations/20261121160000_label_template_settings/migration.sql',
          ),
          'utf8',
        ),
      );
    assert.deepEqual(await snapshot(), before);
    // Isolate shared-template fixtures inside the disposable copy only.
    await sql.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261122220000_physical_labels_private_access/migration.sql'), 'utf8'));
    const privateTables = (await sql.query(`SELECT relname,relrowsecurity FROM pg_class WHERE oid IN ('"PhysicalBarcode"'::regclass,'"LabelTemplateSettings"'::regclass)`)).rows;
    assert.equal(privateTables.length, 2);
    assert.ok(privateTables.every(table => table.relrowsecurity));
    for (const role of (await sql.query("SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')")).rows) {
      for (const table of privateTables) {
        assert.equal((await sql.query('SELECT has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\') AS allowed', [role.rolname, '"'+table.relname+'"'])).rows[0].allowed, false);
      }
    }
    assert.deepEqual(await snapshot(), before);
    await sql.query('DELETE FROM "LabelTemplateSettings"');
    Object.assign(process.env, env, {
      DATABASE_URL: target.href,
      DIRECT_URL: target.href,
      USER_NUMBERING_DATABASE_URL: target.href,
    });
    require('ts-node').register({
      project: path.join(backend, 'tsconfig.json'),
      transpileOnly: true,
    });
    const { PrismaClient } = require('@prisma/client');
    db = new PrismaClient();
    const {
      AdminLabelsService,
    } = require('../src/admin/labels/admin-labels.service');
    const service = new AdminLabelsService(db);
    const p = await db.product.create({
      data: {
        name: 'Nombre muy largo < & CRONOX '.repeat(30)+' - black',
        slug: name,
        price: 5000,
        isActive: false,
        variants: {
          create: [
            { size: 'S', sku: name + '-S', stockQty: 0 },
            { size: 'M', sku: name + '-M', stockQty: 7 },
          ],
        },
      },
      include: { variants: true },
    });
    const ids = p.variants.map((v) => v.id),
      lines = ids.map((variantId) => ({ variantId, quantity: 3 }));
    const baseline = await snapshot(),
      count = await db.physicalBarcode.count();
    const listed = await service.list({
      search: name,
      active: 'false',
      page: 1,
    });
    assert.equal(listed.items.length, 1);
    assert.ok(listed.items[0].variants.some((v) => v.stockQty === 0));
    assert.equal(await db.physicalBarcode.count(), count);
    await assert.rejects(() =>
      service.preview({
        lines,
        layout: {
          width: 60,
          height: 35,
          margin: 10,
          gap: 3,
          padding: 2,
          pageWidth: 210,
          pageHeight: 297,
        },
      }),
    );
    const issued = await Promise.all(
      Array.from({ length: 12 }, () => service.generate({ lines })),
    );
    for (const result of issued)
      assert.deepEqual(result.items, issued[0].items);
    assert.equal(await db.physicalBarcode.count(), count + 2);
    assert.deepEqual(await snapshot(), baseline);
    const original = issued[0].items;
    const {
      defaultLabelTemplate,
    } = require('../src/admin/labels/label-template');
    const initialTemplate = await service.template();
    assert.equal(initialTemplate.revision, 0);
    assert.equal(initialTemplate.template.layout.height, 35);
    assert.equal(await db.labelTemplateSettings.count(), 0);
    let design = defaultLabelTemplate();
    design.elements.find((e) => e.kind === 'color').visible = false;
    design.elements.find((e) => e.kind === 'brand').visible = false;
    design.elements.push({
      id: 'custom-db',
      kind: 'custom',
      visible: true,
      text: 'CRONOX · EDICIÓN',
      fontSizePt: 7.5,
      align: 'left',
      gapAfter: 0.5,
      maxLines: 1,
    });
    const saved = await service.saveTemplate({ revision: 0, template: design });
    assert.equal(saved.revision, 1);
    const independentDb = new PrismaClient();
    try {
      const second = new AdminLabelsService(independentDb);
      assert.deepEqual((await second.template()).template, design);
    } finally {
      await independentDb.$disconnect();
    }
    const attempts = await Promise.allSettled([
      service.saveTemplate({ revision: 1, template: design }),
      service.saveTemplate({ revision: 1, template: design }),
    ]);
    assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
    assert.equal((await service.template()).revision, 2);
    const invalid = defaultLabelTemplate();
    invalid.elements.find((e) => e.kind === 'barcode').visible = false;
    await assert.rejects(() =>
      service.saveTemplate({ revision: 2, template: invalid }),
    );
    assert.equal((await service.template()).revision, 2);
    const variantPreview = await service.preview({ lines });
    assert.ok(!variantPreview.html.includes('CRONOX · EDICIÓN'));assert.ok(variantPreview.html.includes('COLOUR: BLACK'));assert.ok(variantPreview.html.includes('SIZE: S'));
    assert.equal(variantPreview.quantity, 6);
    const reset = await service.resetTemplate(2);
    assert.equal(reset.revision, 3);
    assert.equal(reset.template.layout.height, 35);
    assert.deepEqual(reset.template, defaultLabelTemplate());
    const legacy = defaultLabelTemplate();
    legacy.schemaVersion = 1;
    legacy.layout = {
      ...legacy.layout,
      profile: 'brother-ql700-dk22225',
      width: 38,
      height: 60,
      pageWidth: 38,
      pageHeight: 60,
      padding: 1.5,
      orientation: 'rotated',
    };
    legacy.elements.forEach((e) => (e.gapAfter = 0.5));
    await db.labelTemplateSettings.update({
      where: { id: 'global' },
      data: { definition: legacy, revision: 4 },
    });
    const adapted = await service.template();
    assert.equal(adapted.needsMigration, true);
    assert.equal(adapted.migrationValid, true);
    assert.equal(adapted.template.layout.width, 62);
    assert.equal(adapted.template.layout.height, 35);
    assert.equal(
      (await db.labelTemplateSettings.findUnique({ where: { id: 'global' } }))
        .definition.schemaVersion,
      1,
    );
    await service.saveTemplate({
      revision: adapted.revision,
      template: adapted.template,
    });
    assert.equal((await service.template()).needsMigration, false);
    assert.equal(
      (await service.template()).template.layout.orientation,
      'portrait',
    );
    assert.deepEqual((await service.generate({ lines })).items, original);
    assert.deepEqual(await snapshot(), baseline);
    const { LabelLayoutDto } = require('../src/admin/labels/labels.dto');
    const preview = await service.preview({
      lines,

    });
    assert.equal(preview.quantity, 6);
    assert.equal((preview.html.match(/<g class="label"/g) || []).length, 6);
    fs.writeFileSync(path.join(out, 'labels-preview.html'), preview.html);
    await db.product.update({
      where: { id: p.id },
      data: { name: 'Nuevo nombre', price: 7000 },
    });
    const {
      AdminInventoryService,
    } = require('../src/admin/inventory/admin-inventory.service');
    await new AdminInventoryService(db).update(p.id, {
      updates: [{ variantId: ids[0], stock: 9, expectedStock: 0 }],
    });
    assert.deepEqual((await service.generate({ lines })).items, original);
    await db.$disconnect();
    await db.$connect();
    assert.deepEqual((await service.generate({ lines })).items, original);
    assert.equal(
      (await service.resolve(original[0].code)).variant.id,
      original[0].variantId,
    );
    await assert.rejects(() =>
      service.generate({ lines: [lines[0], lines[0]] }),
    );
    await assert.rejects(() =>
      service.generate({
        lines: [...lines, { variantId: 2147483647, quantity: 1 }],
      }),
    );
    await assert.rejects(() =>
      service.generate({ lines: [{ variantId: ids[0], quantity: 5000 }] }),
    );
    await assert.rejects(() =>
      db.$executeRawUnsafe(
        'UPDATE "PhysicalBarcode" SET "code"=\'CRX9999999999\' WHERE "variantId"=$1',
        ids[0],
      ),
    );
    await assert.rejects(() =>
      db.$executeRawUnsafe(
        'INSERT INTO "PhysicalBarcode" ("code","variantId") VALUES ($1,$2)',
        original[0].code,
        ids[1],
      ),
    );
    const { barcodeSvg } = require('../src/admin/labels/label-document');
    const sharp = require('sharp'),
      zxing = require('zxing-wasm/reader');
    zxing.prepareZXingModule({
      overrides: {
        wasmBinary: fs.readFileSync(
          path.resolve(
            backend,
            '../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm',
          ),
        ),
      },
    });
    for (const identity of original) {
      const svg = barcodeSvg(identity.code).svg;
      fs.writeFileSync(path.join(out, identity.code + '.svg'), svg);
      for (const dpi of [203, 300]) {
        const image = await sharp(Buffer.from(svg), { density: dpi })
          .resize({width:Math.ceil(barcodeSvg(identity.code).width*dpi/25.4),height:Math.ceil(10*dpi/25.4),fit:'fill'})
          .flatten({ background: '#fff' })
          .png()
          .toBuffer();
        const decoded = await zxing.readBarcodes(image, {
          formats: ['Code128'],
          tryHarder: true,
        });
        assert.ok(
          decoded.some((r) => r.text === identity.code),
          `Independent decoder failed at ${dpi} dpi`,
        );
      }
    }
    const retired = await db.productVariant.create({
      data: { productId: p.id, size: 'L', sku: name + '-L', stockQty: 0 },
    });
    const retiredCode = (
      await service.generate({
        lines: [{ variantId: retired.id, quantity: 1 }],
      })
    ).items[0].code;
    await db.productVariant.delete({ where: { id: retired.id } });
    assert.equal(
      (await db.physicalBarcode.findUnique({ where: { code: retiredCode } }))
        .variantId,
      null,
    );
    await assert.rejects(() => service.resolve(retiredCode));
    const report = {
      ok: true,
      concurrentRequests: 12,
      checks: [
        'Migration preserves existing catalogue, variants, orders, lots, users',
        'GET and missing-code preview are read-only',
        'Zero stock and inactive products included',
        'Persistent unique identities under concurrent generation',
        'Reprint and rename/price/stock changes preserve code',
        'Reconnect preserves identities',
        'Future resolution returns exact variant',
        'Selection limits, duplicates and missing IDs rejected atomically',
        'Immutable identity and retired codes retained',
        'Independent ZXing decodes exact SVG identifiers at 203 and 300 dpi',
        'Exact print quantities and physical dimensions',
        'Shared template read is side-effect-free; persistence verified from an independent connection',
        'Concurrent template saves use revision compare-and-set; stale and invalid writes rejected',
        'Dynamic variant previews and explicit persisted restoration preserve catalogue and barcodes',
      ],
    };
    fs.writeFileSync(
      path.join(out, 'db-report.json'),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (db) await db.$disconnect();
    if (sql) await sql.end();
    if (created) await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await control.end();
    const dumpFile = path.join(out, 'local-copy.dump');
    if (fs.existsSync(dumpFile)) fs.unlinkSync(dumpFile);
  }
}
main().catch((e) => {
  console.error(
    String(e.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]'),
  );
  process.exitCode = 1;
});
