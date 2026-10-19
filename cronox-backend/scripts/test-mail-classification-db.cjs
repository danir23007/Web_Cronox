'use strict';
// All writes, including browser review, use a disposable loopback database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const directory = path.resolve(backend, '../test-results/mail-classification');
const stateFile = path.join(directory, 'database.json');
const mode = process.argv[2];
function environment(name) {
  const env = loadLocalEnvironment();
  const url = new URL(env.DATABASE_URL);
  assert.equal(url.host, '127.0.0.1:5433'); assert.equal(url.pathname, '/cronox_dev');
  ensureLocalPostgres(env);
  if (name) {
    assert.match(name, /^cronox_mail_color_test_[a-f0-9]{32}$/);
    url.pathname = '/' + name;
    env.DATABASE_URL = env.DIRECT_URL = url.href;
  }
  return env;
}
const content = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['revision', 'updatedAt', 'updatedBy', 'visualClassification'].includes(key)));
const snapshots = db => db.managedEmailTemplate.findMany({ orderBy: { id: 'asc' } });
async function connect(name) {
  const env = environment(name); Object.assign(process.env, env);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
  return { db, service: new ManagedMailService(db, new Proxy({}, { get() { throw Error('SMTP_FORBIDDEN'); } })) };
}
async function drop(name) {
  const env = environment(); const url = new URL(env.DATABASE_URL); url.search = '';
  assert.match(name, /^cronox_mail_color_test_[a-f0-9]{32}$/);
  const control = new Client({ connectionString: url.href }); await control.connect();
  try { await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); } finally { await control.end(); }
}
async function setup() {
  assert.ok(!fs.existsSync(stateFile), 'Dispose the previous review database first');
  const name = 'cronox_mail_color_test_' + randomUUID().replace(/-/g, '');
  const originalEnv = environment(); const source = new URL(originalEnv.DATABASE_URL); source.search = '';
  const control = new Client({ connectionString: source.href }); await control.connect();
  try { await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); } finally { await control.end(); }
  fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ name }));
  const env = environment(name); const setupUrl = new URL(env.DATABASE_URL); setupUrl.search = '';
  const setupClient = new Client({ connectionString: setupUrl.href }); await setupClient.connect();
  try { await setupClient.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); } finally { await setupClient.end(); }
  const initialized = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
  assert.equal(initialized.status, 0, 'Disposable schema initialization failed');
  const { db, service } = await connect(name);
  try {
    // Reuse only the legitimate local review administrator's login in isolation.
    const { PrismaClient } = require('@prisma/client');
    const sourceDb = new PrismaClient({ datasources: { db: { url: originalEnv.DATABASE_URL } } });
    let admin;
    try { admin = await sourceDb.user.findUniqueOrThrow({ where: { email: originalEnv.LOCAL_ADMIN_EMAIL || 'admin@cronox.local' } }); }
    finally { await sourceDb.$disconnect(); }
    await db.user.create({ data: { id: admin.id, email: admin.email, password: admin.password, role: 'SUPERADMIN', sessionVersion: admin.sessionVersion } });
    for (const key of ['NOREPLY', 'ORDERS', 'INFO', 'SUPPORT']) {
      await db.emailSenderProfile.create({ data: { key, initializedAt: new Date() } });
      for (let n = 1; n <= 5; n++) await db.emailTemplateFolder.create({ data: { id: key + '-' + n, senderKey: key, name: 'Círculo ' + n, position: n - 1 } });
    }
    const seeds = [];
    async function seed(id, sender, n, extra = {}) {
      const data = { id, senderKey: sender, folderId: sender + '-' + n, name: 'Prueba color · ' + n,
        purpose: 'ORDER_CONFIRMATION', subject: 'Asunto independiente ' + n,
        preheader: 'Texto previo ' + n, signatureMode: 'none', visualClassification: 'DIFFERENT',
        document: { blocks: [{ type: 'text', text: 'Texto propio ' + n + ' {{message}}' }, { type: 'image', src: 'https://cronox.es/favicon.png', alt: 'Imagen propia ' + n }] },
        html: '<p>HTML guardado propio ' + n + '</p>', text: 'Texto plano guardado propio ' + n, ...extra };
      await db.managedEmailTemplate.create({ data }); seeds.push(data);
    }
    for (let n = 1; n <= 5; n++) {
      await seed('orders-' + n, 'ORDERS', n, { importKey: `ORDERS:${n}:ORDER_CONFIRMATION` });
      await seed('alternate-' + n, 'ORDERS', n, { importKey: `ORDERS:${n}:ORDER_CONFIRMATION:other-design` });
    }
    await seed('manual-3', 'ORDERS', 3); await seed('manual-1a', 'ORDERS', 1); await seed('manual-1b', 'ORDERS', 1);
    await seed('archived-2', 'ORDERS', 2, { archivedAt: new Date() });
    await seed('foreign-1', 'SUPPORT', 1);
    await seed('welcome-old-1', 'NOREPLY', 1, { purpose: 'NEWSLETTER_WELCOME', importKey: 'NOREPLY:1:NEWSLETTER_WELCOME' });
    await seed('welcome-old-2', 'NOREPLY', 2, { purpose: 'NEWSLETTER_WELCOME', importKey: 'NOREPLY:2:NEWSLETTER_WELCOME' });
    await seed('welcome-approved', 'NOREPLY', 1, { purpose: 'NEWSLETTER_WELCOME', importKey: 'NOREPLY:1:NEWSLETTER_WELCOME:approved-20261019' });
    const family = await db.campaignTemplateFamily.create({ data: { name: 'Familia de revisión', eventKind: 'GENERAL' } });
    for (const n of [1, 3]) await seed('family-' + n, 'INFO', n, { purpose: null, familyId: family.id, campaignCircle: n, textOverride: 'Texto alternativo propio ' + n });
    const historical = await db.emailTemplateVersion.create({ data: { templateId: 'orders-3', snapshot: await service.template('ORDERS', 'orders-3') } });
    const input = async (id, ids, extra = {}) => {
      const t = await service.template(id.startsWith('family-') ? 'INFO' : 'ORDERS', id);
      return { ...t, targets: await Promise.all(ids.map(async selected => ({ id: selected, revision: (await db.managedEmailTemplate.findUniqueOrThrow({ where: { id: selected } })).revision }))), ...extra };
    };
    const original = await snapshots(db);
    for (const [classification, ids] of [['FOR_ALL', ['orders-1', 'orders-3', 'orders-5']], ['UNIQUE', ['orders-3']], ['DIFFERENT', [1, 2, 3, 4, 5].map(n => 'orders-' + n)]]) {
      await service.saveDrafts('ORDERS', 'orders-3', await input('orders-3', ids, { visualClassification: classification, saveMode: 'classification' }));
      for (const id of ids) assert.equal((await db.managedEmailTemplate.findUniqueOrThrow({ where: { id } })).visualClassification, classification);
      assert.deepEqual((await snapshots(db)).map(content), original.map(content));
    }
    assert.deepEqual((await service.draftTargets('NOREPLY', 'welcome-approved')).targets.map(t => t.id), ['welcome-approved']);
    const familyBefore = await db.managedEmailTemplate.findUniqueOrThrow({ where: { id: 'family-1' } });
    await service.saveDrafts('INFO', 'family-3', await input('family-3', ['family-1', 'family-3'], { visualClassification: 'UNIQUE', saveMode: 'classification' }));
    assert.deepEqual(content(await db.managedEmailTemplate.findUniqueOrThrow({ where: { id: 'family-1' } })), content(familyBefore));
    const explicit = await service.draftTargets('ORDERS', 'manual-3'); assert.equal(explicit.requiresExplicitSelection, true);
    assert.deepEqual(explicit.targets.map(t => t.id).sort(), ['manual-1a', 'manual-1b', 'manual-3']);
    await assert.rejects(service.saveDrafts('ORDERS', 'manual-3', await input('manual-3', ['manual-1a', 'manual-3'], { visualClassification: 'FOR_ALL' })), /explícitamente/);
    await service.saveDrafts('ORDERS', 'manual-3', await input('manual-3', ['manual-1a', 'manual-3'], { visualClassification: 'FOR_ALL', explicitSelection: true }));
    for (const selected of ['alternate-1', 'foreign-1', 'archived-2']) {
      const before = await snapshots(db);
      await assert.rejects(service.saveDrafts('ORDERS', 'orders-3', await input('orders-3', [selected, 'orders-3'], { visualClassification: 'FOR_ALL' })));
      assert.deepEqual(await snapshots(db), before);
    }
    const beforeFailure = await snapshots(db);
    const stale = await input('orders-3', ['orders-1', 'orders-3'], { visualClassification: 'FOR_ALL' }); stale.targets[0].revision--;
    await assert.rejects(service.saveDrafts('ORDERS', 'orders-3', stale)); assert.deepEqual(await snapshots(db), beforeFailure);
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_color_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='orders-5' THEN RAISE EXCEPTION 'FIXTURE_WRITE_REJECTED'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER reject_color_fixture BEFORE UPDATE ON "ManagedEmailTemplate" FOR EACH ROW EXECUTE FUNCTION reject_color_fixture()');
    try { await assert.rejects(service.saveDrafts('ORDERS', 'orders-3', await input('orders-3', ['orders-1', 'orders-3', 'orders-5'], { visualClassification: 'FOR_ALL' }))); }
    finally { await db.$executeRawUnsafe('DROP TRIGGER reject_color_fixture ON "ManagedEmailTemplate"'); await db.$executeRawUnsafe('DROP FUNCTION reject_color_fixture()'); }
    assert.deepEqual(await snapshots(db), beforeFailure);
    const concurrent = await input('orders-3', ['orders-1', 'orders-3', 'orders-5'], { visualClassification: 'FOR_ALL' });
    const race = await Promise.allSettled([service.saveDrafts('ORDERS', 'orders-3', concurrent), service.saveDrafts('ORDERS', 'orders-3', { ...concurrent, visualClassification: 'UNIQUE' })]);
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    await service.saveDrafts('ORDERS', 'orders-3', await input('orders-3', ['orders-1', 'orders-3'], { subject: 'Contenido editado expresamente', visualClassification: 'UNIQUE', saveMode: 'content' }));
    assert.equal((await db.managedEmailTemplate.findUniqueOrThrow({ where: { id: 'orders-1' } })).subject, 'Contenido editado expresamente');
    assert.deepEqual(await db.emailTemplateVersion.findUniqueOrThrow({ where: { id: historical.id } }), historical);
    assert.equal(await db.emailPublication.count(), 0); assert.equal(await db.emailDelivery.count(), 0);
    assert.equal(await db.order.count(), 0); assert.equal(await db.promoCode.count(), 0); assert.equal(await db.emailTemplateFolder.count(), 20);
    // Reset disposable fixtures for the browser without rewinding revisions/history.
    for (const data of seeds) await db.managedEmailTemplate.update({ where: { id: data.id }, data: { ...data, revision: { increment: 1 } } });
    // The real panel initializes missing first-party purposes when opening a
    // mailbox. Prepare that existing behavior before taking the review baseline.
    for (const key of ['NOREPLY', 'ORDERS', 'INFO', 'SUPPORT']) await service.initialize(key);
    const baseline = await snapshots(db);
    fs.writeFileSync(stateFile, JSON.stringify({ name, baseline, historical, adminEmail: admin.email }, null, 2));
    console.log('PASS: three colors, 1/3/5, single/all, distinct content, import/family/manual identities, mailbox/design isolation, stale revisions, real transaction rollback, concurrency, history preserved; zero SMTP/publications/orders/promotions.');
    return name;
  } finally { await db.$disconnect(); }
}
async function main() {
  if (!mode || mode === '--setup') {
    let name;
    try { name = await setup(); }
    finally { if (!mode && fs.existsSync(stateFile)) { name ||= JSON.parse(fs.readFileSync(stateFile)).name; await drop(name); fs.unlinkSync(stateFile); } }
    return;
  }
  const state = JSON.parse(fs.readFileSync(stateFile));
  if (mode === '--cleanup') { await drop(state.name); fs.unlinkSync(stateFile); console.log('Disposable review database removed'); return; }
  if (mode === '--serve') {
    Object.assign(process.env, environment(state.name), { PORT: '43129', FRONTEND_URL: 'http://localhost:43129', API_PUBLIC_URL: 'http://localhost:43129', CORS_ORIGINS: 'http://localhost:43129' });
    require('../../output/playwright/audit-fixes-20261017/audit-env.cjs').installNetworkGuard();
    require('../dist/main.js'); return;
  }
  assert.ok(['--verify', '--verify-content'].includes(mode));
  const expected = process.argv[3].split(','); assert.equal(expected.length, 5);
  const { db } = await connect(state.name);
  try {
    const actual = JSON.parse(JSON.stringify(await snapshots(db)));
    if (mode === '--verify-content') {
      const selected = ['orders-1', 'orders-3', 'orders-5'];
      const source = actual.find(t => t.id === 'orders-3');
      const untouched = row => Object.fromEntries(Object.entries(content(row)).filter(([key]) => !['subject', 'preheader', 'document', 'signatureMode', 'signatureId', 'html', 'text'].includes(key)));
      for (const id of selected) {
        const row = actual.find(t => t.id === id), before = state.baseline.find(t => t.id === id);
        assert.equal(row.subject, 'Revisión de contenido explícita');
        assert.deepEqual(row.document, source.document); assert.equal(row.html, source.html); assert.equal(row.text, source.text);
        assert.deepEqual(untouched(row), untouched(before));
      }
      assert.deepEqual(actual.filter(t => !selected.includes(t.id)).map(content), state.baseline.filter(t => !selected.includes(t.id)).map(content));
    } else assert.deepEqual(actual.map(content), state.baseline.map(content));
    for (let n = 1; n <= 5; n++) assert.equal(actual.find(t => t.id === 'orders-' + n).visualClassification, expected[n - 1]);
    for (const before of state.baseline.filter(t => !/^orders-/.test(t.id))) assert.deepEqual(actual.find(t => t.id === before.id), before);
    assert.equal(await db.emailPublication.count(), 0); assert.equal(await db.emailDelivery.count(), 0); assert.equal(await db.emailTemplateFolder.count(), 20);
    console.log('PASS persisted colors: ' + JSON.stringify(expected) + '; all per-circle content, other designs/mailboxes, folders and publications unchanged.');
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(String(error.stack).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[PRIVATE_DATABASE_URL]')); process.exitCode = 1; });
