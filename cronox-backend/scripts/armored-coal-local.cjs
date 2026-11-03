// Scoped local-only application and real PostgreSQL regression for the release
// migration. Production uses prisma migrate deploy, never this local launcher.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const sql = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261103090000_armored_coal_slug/migration.sql'), 'utf8');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function snapshot(client) {
  const product = (await client.query('SELECT * FROM "Product" WHERE id=4')).rows[0];
  const columns = (await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' AND column_name IN ('productId','variantId','productVariantId') ORDER BY table_name, column_name`)).rows;
  const tables = [...new Set(columns.map(r => r.table_name))];
  // Compare all these local rows, including variants/images/categories/carts,
  // favorites and immutable order/checkout lines. Emit hashes, never order data.
  const relations = {};
  for (const table of tables) {
    const quoted = '"' + table.replaceAll('"', '""') + '"';
    const predicates = columns.filter(c => c.table_name === table).map(c => c.column_name === 'productId'
      ? '"productId"=4' : `"${c.column_name}" IN (SELECT id FROM "ProductVariant" WHERE "productId"=4)`);
    const rows = (await client.query(`SELECT to_jsonb(t) AS row FROM ${quoted} t WHERE ${predicates.join(' OR ')} ORDER BY to_jsonb(t)::text`)).rows;
    relations[table] = { count: rows.length, digest: digest(rows) };
  }
  const retained = product && { ...product };
  if (retained) { delete retained.slug; delete retained.updatedAt; }
  return { product: product && { id: product.id, name: product.name, slug: product.slug }, retained: digest(retained || null), relations };
}
async function regression(client) {
  const schema = 'cronox_slug_test_' + randomUUID().replaceAll('-', '');
  assert.match(schema, /^cronox_slug_test_[a-f0-9]{32}$/);
  await client.query(`CREATE SCHEMA "${schema}"`);
  try {
    await client.query(`SET search_path TO "${schema}"`);
    await client.query('CREATE TABLE "Product" (id integer PRIMARY KEY, name text NOT NULL, slug text UNIQUE NOT NULL, "updatedAt" timestamp NOT NULL DEFAULT now(), price integer DEFAULT 6500)');
    await client.query("INSERT INTO \"Product\" (id,name,slug) VALUES (4,'ARMORED COAL','shielded-coal'),(5,'Other','other')");
    const original = (await client.query('SELECT id,name,price FROM "Product" ORDER BY id')).rows;
    await client.query(sql);
    assert.equal((await client.query('SELECT slug FROM "Product" WHERE id=4')).rows[0].slug, 'armored-coal');
    await client.query(sql); // Repeat application is harmless.
    assert.deepEqual((await client.query('SELECT id,name,price FROM "Product" ORDER BY id')).rows, original);
    await assert.rejects(client.query("UPDATE \"Product\" SET slug='shielded-coal' WHERE id=4"), /Product_armored_coal_slug_check/);
    await client.query('ALTER TABLE "Product" DROP CONSTRAINT "Product_armored_coal_slug_check"');
    await client.query("UPDATE \"Product\" SET slug='shielded-coal' WHERE id=4");
    await client.query("UPDATE \"Product\" SET slug='armored-coal' WHERE id=5");
    await assert.rejects(client.query(sql), /slug collision/);
    await client.query('ROLLBACK');
    assert.equal((await client.query('SELECT slug FROM "Product" WHERE id=4')).rows[0].slug, 'shielded-coal');
    await client.query('DELETE FROM "Product" WHERE id=5');
    await client.query("UPDATE \"Product\" SET name='Unexpected' WHERE id=4");
    await assert.rejects(client.query(sql), /identity differs/);
    await client.query('ROLLBACK');
    await client.query('DELETE FROM "Product"');
    await client.query(sql); // Empty installations remain deployable.
    console.log('PASS PostgreSQL: in-place update, repetition, collision rollback, identity guard, reserved slug, empty database.');
  } finally {
    await client.query('ROLLBACK');
    await client.query('SET search_path TO public');
    await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
}
async function main() {
  const env = loadLocalEnvironment();
  ensureLocalPostgres(env);
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    if (process.argv.includes('--test')) return await regression(client);
    const before = await snapshot(client);
    assert.deepEqual(before.product && { id: before.product.id, name: before.product.name }, { id: 4, name: 'ARMORED COAL' });
    assert.ok(['shielded-coal', 'armored-coal'].includes(before.product.slug));
    const collision = (await client.query("SELECT id FROM \"Product\" WHERE slug IN ('shielded-coal','armored-coal') AND id<>4")).rows;
    assert.equal(collision.length, 0, 'Slug collision');
    if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ mode: 'local dry run', ...before }, null, 2)); return; }
    await client.query(sql);
    const after = await snapshot(client);
    assert.equal(after.product.slug, 'armored-coal');
    assert.equal(after.retained, before.retained);
    assert.deepEqual(after.relations, before.relations);
    const report = { at: new Date().toISOString(), mode: 'local applied', product: after.product, retainedProductFieldsUnchanged: true, relationsUnchanged: after.relations };
    const directory = path.resolve(__dirname, '../../test-results/indexability');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'local-migration.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await client.end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
