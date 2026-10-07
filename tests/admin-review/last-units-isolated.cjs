// Fresh, disposable PostgreSQL test database. Never runs against the historical
// local review or production; no guards/middleware are replaced or disabled.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const backend = path.join(root, 'cronox-backend');
const { PrismaClient } = require(path.join(backend, 'node_modules/@prisma/client'));
const bcrypt = require(path.join(backend, 'node_modules/bcrypt'));
const { loadLocalEnvironment } = require(path.join(backend, 'scripts/start-local.cjs'));
const { withTestEnvironment } = require(path.join(backend, 'test/test-environment.cjs'));
const directory = path.join(root, 'output/playwright/last-units-release');
const manifest = path.join(directory, 'isolated-private.json');
const local = loadLocalEnvironment();
const source = new URL(local.DATABASE_URL);
assert.equal(source.host, '127.0.0.1:5433');
assert.equal(source.pathname, '/cronox_dev');
const adminUrl = new URL(source); adminUrl.pathname = '/postgres';
const admin = new PrismaClient({ datasources: { db: { url: adminUrl.href } } });
const mode = process.argv[2] || 'setup';
(async () => {
  fs.mkdirSync(directory, { recursive: true });
  if (mode === 'setup') {
    assert(!fs.existsSync(manifest), 'Clean up the previous isolated fixture first');
    const tag = randomUUID().slice(0, 8);
    const database = 'cronox_avisa_release_test_' + tag;
    assert(/^cronox_avisa_release_test_[a-f0-9]{8}$/.test(database));
    await admin.$executeRawUnsafe('CREATE DATABASE "' + database + '"');
    const target = new URL(source); target.pathname = '/' + database;
    const origin = 'http://127.0.0.1:43129';
    // Independent test profile: no historical snapshot flag and no deployed
    // secrets. Existing JWT, CSRF, throttling and localReviewSafety still run.
    const osEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      /^(Path|PATH|SystemRoot|SYSTEMROOT|ComSpec|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PATHEXT|WINDIR)$/i.test(key)));
    const envFile = path.join(directory, 'isolated.env');
    const env = withTestEnvironment(osEnv, { force: true, overrides: {
      DATABASE_URL: target.href, DIRECT_URL: target.href, PORT: '43129', HOST: '127.0.0.1',
      FRONTEND_URL: origin, API_PUBLIC_URL: origin, CORS_ORIGINS: origin,
      CRONOX_ENV_FILE: envFile, DOTENV_CONFIG_PATH: envFile,
      BACKGROUND_JOBS_ENABLED: 'false', WAITLIST_EMAIL_WORKER_ENABLED: 'false',
      NEWSLETTER_EMAIL_WORKER_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false',
      MAILBOX_SEND_ENABLED: 'false', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '',
      SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '',
    } });
    assert.equal(env.NODE_ENV, 'test');
    assert.equal(env.EMAIL_ENABLED, 'false');
    assert(!('CRONOX_LOCAL_DEV' in env));
    fs.writeFileSync(envFile, Object.entries(env).filter(([key]) => !(key in osEnv))
      .map(([key, value]) => key + '=' + JSON.stringify(value)).join('\n'));
    fs.writeFileSync(manifest, JSON.stringify({ database, url: target.href, origin }));
    // Historical migrations require a pre-existing legacy baseline. Copy only
    // the verified local schema and its actual migration history, never users,
    // products or other historical data. The source remains untouched.
    assert(local.LOCAL_PG_BIN, 'Local PostgreSQL tools are required');
    const pgEnv = { ...osEnv, PGHOST: source.hostname, PGPORT: source.port,
      PGUSER: decodeURIComponent(source.username), PGPASSWORD: decodeURIComponent(source.password) };
    const schemaFile = path.join(directory, 'isolated-schema.sql');
    const historyFile = path.join(directory, 'isolated-migration-history.sql');
    const pgTool = name => path.join(local.LOCAL_PG_BIN, name + (process.platform === 'win32' ? '.exe' : ''));
    const sourceDb = new PrismaClient({ datasources: { db: { url: source.href } } });
    const extensions = await sourceDb.$queryRawUnsafe("SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'");
    await sourceDb.$disconnect();
    // Extensions are cluster-supported prerequisites, not copied business data.
    for (const { extname } of extensions) {
      assert(/^[a-z0-9_]+$/.test(extname));
      cp.execFileSync(pgTool('psql'), ['--dbname=' + database, '--set=ON_ERROR_STOP=1', '--command=CREATE EXTENSION IF NOT EXISTS "' + extname + '"'], { env: pgEnv, stdio: 'pipe' });
    }
    cp.execFileSync(pgTool('pg_dump'), ['--dbname=cronox_dev', '--schema=public', '--schema-only', '--file=' + schemaFile], { env: pgEnv });
    cp.execFileSync(pgTool('pg_dump'), ['--dbname=cronox_dev', '--data-only', '--table=public._prisma_migrations', '--file=' + historyFile], { env: pgEnv });
    // pg_trgm must live in public before indexes are restored. Avoid the schema
    // creation statement because the fresh database already owns that schema.
    fs.writeFileSync(schemaFile, fs.readFileSync(schemaFile, 'utf8').replace(/^CREATE SCHEMA public;\r?\n/m, ''));
    for (const file of [schemaFile, historyFile]) cp.execFileSync(pgTool('psql'),
      ['--dbname=' + database, '--set=ON_ERROR_STOP=1', '--file=' + file], { env: pgEnv, stdio: 'pipe' });
    cp.execFileSync(process.execPath, [require.resolve(path.join(backend, 'node_modules/prisma/build/index.js')), 'migrate', 'deploy'],
      { cwd: backend, env, stdio: ['ignore', fs.openSync(path.join(directory, 'isolated-migrations.log'), 'w'), 'pipe'] });
    const db = new PrismaClient({ datasources: { db: { url: target.href } } });
    let fixture;
    try {
      const password = 'Isolated-QA-' + randomUUID();
      const actor = await db.user.create({ data: { email: 'isolated-' + tag + '@example.test', role: 'USER', accountState: 'ACTIVE', password: await bcrypt.hash(password, 10) } });
      const products = [];
      for (const name of ['selected', 'other']) {
        const product = await db.product.create({ data: {
          name: 'Isolated ' + name, slug: 'isolated-' + tag + '-' + name, price: 4200, lastUnitsThreshold: 5,
          images: { create: [{ url: origin + '/assets/logo-topbar.webp', isPrimary: true }] },
          variants: { create: ['XS', 'S', 'M', 'L'].map((size, i) => ({ size, stockQty: i === 3 ? 2 : 0, sku: tag + '-' + name + '-' + size })) },
        }, include: { variants: true } });
        products.push({ id: product.id, slug: product.slug, variants: product.variants.map(v => ({ id: v.id, size: v.size })) });
      }
      fixture = { database, url: target.href, origin, actor: { id: actor.id, email: actor.email, password }, products };
    } finally { await db.$disconnect(); }
    const stdout = fs.openSync(path.join(directory, 'isolated-backend.log'), 'w');
    const stderr = fs.openSync(path.join(directory, 'isolated-backend-error.log'), 'w');
    const child = cp.spawn(process.execPath, [path.join(backend, 'dist/main.js')], { cwd: backend, env, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr] });
    child.unref(); fixture.pid = child.pid;
    fs.writeFileSync(manifest, JSON.stringify(fixture));
    const template = fs.readFileSync(path.join(__dirname, 'last-units-isolated.browser.js'), 'utf8');
    fs.writeFileSync(path.join(directory, 'isolated-browser-private.js'), template.replace('__FIXTURE__', JSON.stringify(fixture)));
    console.log(JSON.stringify({ database, origin, pid: child.pid, emailEnabled: false, workersEnabled: false, historicalDatabaseUsed: false, guardsOverridden: false }));
  } else {
    const fixture = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert(/^cronox_avisa_release_test_[a-f0-9]{8}$/.test(fixture.database));
    const target = new URL(fixture.url);
    assert.equal(target.host, source.host); assert.equal(target.pathname, '/' + fixture.database);
    if (mode === 'verify') {
      const db = new PrismaClient({ datasources: { db: { url: target.href } } });
      try {
        const rows = await db.restockRequest.findMany({ include: { variant: { select: { productId: true, size: true } } } });
        assert(rows.length > 0);
        assert(rows.every(r => r.userId === fixture.actor.id && r.variant.productId === fixture.products[0].id && r.variant.size === 'S'));
        assert(rows.every(r => !r.acceptedAt && !r.claimedAt));
        console.log(JSON.stringify({ records: rows.length, chosenProductAndSize: true, statuses: rows.map(r => r.status), noMailClaimOrAcceptance: true }));
      } finally { await db.$disconnect(); }
    } else if (mode === 'cleanup') {
      // Operator stops only the recorded test listener before calling cleanup.
      const active = await admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=$1', fixture.database);
      assert.equal(active[0].count, 0, 'Stop the isolated test backend first');
      await admin.$executeRawUnsafe('DROP DATABASE "' + fixture.database + '"');
      fs.unlinkSync(manifest);
      console.log('Only the owned disposable test database removed.');
    } else throw Error('Use setup, verify or cleanup');
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => admin.$disconnect());
