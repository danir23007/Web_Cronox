// Disposable PostgreSQL and real application services. Never loads .env or contacts providers.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const backend = path.resolve(__dirname, '..');
const bin = process.env.CRONOX_REVIEW_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const exe = n => path.join(bin, n + (process.platform === 'win32' ? '.exe' : ''));
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { windowsHide: true, stdio: 'pipe', ...options });
const report = [];
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cronox-security-'));
  const data = path.join(dir, 'pg');
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port; await new Promise(r => probe.close(r));
  const resilience = process.argv.includes('--resilience');
  const url = `postgresql://cronox_audit@127.0.0.1:${port}/postgres` + (resilience ? '?connection_limit=2&pool_timeout=1&connect_timeout=1' : '');
  const env = require('../test/test-environment.cjs').withTestEnvironment({}, { force: true });
  for (const key of Object.keys(process.env)) if (/^(SMTP_|MAILBOX_|SUPABASE_)/.test(key)) delete process.env[key];
  Object.assign(process.env, env, { DATABASE_URL: url, DIRECT_URL: url, CRONOX_ENV_FILE: path.join(dir, 'absent.env'),
    BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false', WAITLIST_EMAIL_WORKER_ENABLED: 'false', SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' });
  run(exe('initdb'), ['-D', data, '-U', 'cronox_audit', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  run(exe('pg_ctl'), ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { stdio: 'ignore' });
  let db;
  try {
    const sql = run(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(backend, 'prisma/schema.prisma'), '--script'], { cwd: dir, env: process.env });
    const schema = path.join(dir, 'schema.sql'); await fs.writeFile(schema, 'CREATE EXTENSION IF NOT EXISTS pg_trgm;\n' + sql);
    run(exe('psql'), [url.split('?')[0], '-v', 'ON_ERROR_STOP=1', '-f', schema]);
    // Prisma's generated runtime must not load credentials from the working repository.
    const runtimePath = require.resolve('@prisma/client/runtime/library.js'), runtime = require(runtimePath);
    require.cache[runtimePath].exports = new Proxy(runtime, { get(target, key) {
      if (key === 'warnEnvConflicts') return () => {};
      if (key === 'getPrismaClient') return config => {
        const Client = target.getPrismaClient({ ...config, relativeEnvPaths: {} });
        return resilience ? require('./review-resilience.cjs').instrumentClient(Client) : Client;
      };
      return Reflect.get(target, key);
    } });
    const { PrismaClient } = require('@prisma/client'); db = new PrismaClient({ datasources: { db: { url } } });
    // This partial index is not represented by Prisma's datamodel diff.
    const migration = await fs.readFile(path.join(backend, 'prisma/migrations/20260812140000_guest_checkout_ownership/migration.sql'), 'utf8');
    const indexFile = path.join(dir, 'active-checkout.sql');
    await fs.writeFile(indexFile, migration.slice(migration.indexOf('DROP INDEX IF EXISTS "CheckoutSnapshot_active_cart_key"')));
    run(exe('psql'), [url.split('?')[0], '-v', 'ON_ERROR_STOP=1', '-f', indexFile]);
    if (process.argv.includes('--completion')) {
      const securitySql = path.join(dir, 'email-change-private.sql');
      await fs.writeFile(securitySql, 'CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; GRANT USAGE ON SCHEMA public TO anon, authenticated; GRANT SELECT ON "EmailChangeRequest" TO anon, authenticated;\n' +
        await fs.readFile(path.join(backend, 'prisma/migrations/20261005200000_email_change_private/migration.sql'), 'utf8'));
      run(exe('psql'), [url.split('?')[0], '-v', 'ON_ERROR_STOP=1', '-f', securitySql]);
      await require('./review-security-completion.cjs')({ db, dir });
      return;
    }
    if (resilience) {
      await require('./review-resilience.cjs').review({ db, dir,
        stop: () => run(exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']),
        start: () => run(exe('pg_ctl'), ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { stdio: 'ignore' }),
      });
      return;
    }
    const { AddressesService } = require('../dist/addresses/addresses.service');
    const { CartService } = require('../dist/cart/cart.service');
    const user = await db.user.create({ data: { email: 'audit-address@example.test', role: 'USER', accountState: 'ACTIVE' } });
    const addresses = new AddressesService(db);
    // Hold the first two completed reads only in diagnosis mode to reproduce
    // a legitimate interleaving deterministically; queries still run in PostgreSQL.
    const rendezvous = () => {
      let arrived = 0, release;
      const ready = new Promise(resolve => { release = resolve; });
      return async result => { if (++arrived <= 2) { if (arrived === 2) release(); await ready; } return result; };
    };
    const addressRead = rendezvous(), cartRead = rendezvous();
    const diagnosticDb = process.argv.includes('--diagnose') ? db.$extends({ query: {
      address: { async count({args, query}) { return addressRead(await query(args)); } },
      cartItem: { async findUnique({args, query}) { return cartRead(await query(args)); } },
    } }) : db;
    const address = { name: 'Audit User', line1: 'Test Street 1', city: 'Madrid', zip: '28001', country: 'ES' };
    for (let i = 0; i < 9; i++) await addresses.create(user.id, address);
    const racingAddresses = new AddressesService(diagnosticDb);
    const results = await Promise.allSettled([racingAddresses.create(user.id, address), racingAddresses.create(user.id, address)]);
    const addressCount = await db.address.count({ where: { userId: user.id } });
    report.push({ check: 'Concurrent address limit', accepted: results.filter(r => r.status === 'fulfilled').length, count: addressCount, expected: 10 });
    await db.address.deleteMany({ where: { userId: user.id } });
    await Promise.all([addresses.create(user.id, { ...address, isDefault: true }), addresses.create(user.id, { ...address, isDefault: true })]);
    const defaults = await db.address.count({ where: { userId: user.id, isDefault: true } });
    report.push({ check: 'Concurrent default addresses', defaults, expected: 1 });
    const product = await db.product.create({ data: { name: 'Audit shirt', slug: 'audit-shirt', price: 2500, variants: { create: { sku: 'AUDIT-M', size: 'M', stockQty: 20 } } }, include: { variants: true } });
    const carts = new CartService(db);
    const context = { userId: user.id }, item = { variantId: product.variants[0].id, qty: 1 };
    await carts.addItem(context, item);
    const racingCarts = new CartService(diagnosticDb);
    const adds = await Promise.allSettled([racingCarts.addItem(context, item), racingCarts.addItem(context, item)]);
    const cart = await carts.getOrCreateCart(context);
    report.push({ check: 'Concurrent cart additions', accepted: adds.filter(r => r.status === 'fulfilled').length, quantity: cart.items[0].qty, expected: 3 });
    console.log(JSON.stringify(report, null, 2));
    if (!process.argv.includes('--diagnose')) {
      assert.equal(addressCount, 10); assert.equal(defaults, 1); assert.equal(cart.items[0].qty, 3);
    }
    await require('./review-security-checkout.cjs')({ db });
    await require('./review-security-admin.cjs')({ db });
    await require('./review-security-http.cjs')({ db, dir, diagnose: process.argv.includes('--diagnose') });
  } finally {
    await db?.$disconnect();
    run(exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  }
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
