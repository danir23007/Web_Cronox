'use strict';
// Disposable local database only. No customer, order, promotion or email fixtures.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
async function main() {
  const environment = loadLocalEnvironment();
  const source = new URL(environment.DATABASE_URL);
  assert.equal(source.host, '127.0.0.1:5433');
  assert.equal(source.pathname, '/cronox_dev');
  ensureLocalPostgres(environment);
  const name = 'cronox_welcome_import_test_' + randomUUID().replace(/-/g, '');
  assert.match(name, /^cronox_welcome_import_test_[a-f0-9]{32}$/);
  const controlUrl = new URL(source); controlUrl.search = '';
  const control = new Client({ connectionString: controlUrl.href });
  let created = false, db;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name;
    Object.assign(environment, { DATABASE_URL: target.href, DIRECT_URL: target.href, EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false' });
    Object.assign(process.env, environment);
    const setupUrl = new URL(target); setupUrl.search = '';
    const setup = new Client({ connectionString: setupUrl.href }); await setup.connect();
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); } finally { await setup.end(); }
    const initialized = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], { cwd: path.resolve(__dirname, '..'), env: environment, windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(initialized.status, 0, 'Disposable schema initialization failed');
    const { PrismaClient } = require('@prisma/client');
    const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
    const { welcomeDocument, WELCOME_SUBJECT } = require('../dist/email/managed/welcome-design');
    db = new PrismaClient({ datasources: { db: { url: target.href } } });
    const service = new ManagedMailService(db, new Proxy({}, { get() { throw Error('MAIL_FORBIDDEN'); } }));
    await db.emailSenderProfile.create({ data: { key: 'NOREPLY' } });
    await assert.rejects(() => service.importApprovedWelcomeDraft(), /canónica/);
    const folder = await db.emailTemplateFolder.create({ data: { senderKey: 'NOREPLY', name: 'Círculo 1' } });
    const original = await service.save('NOREPLY', { name: 'Personalización vigente', folderId: folder.id, purpose: 'NEWSLETTER_WELCOME', subject: 'Asunto vigente', preheader: '', signatureMode: 'none', document: { blocks: [{ type: 'text', text: '{{message}} {{discountCode}}' }] } });
    const version = await db.emailTemplateVersion.create({ data: { templateId: original.id, snapshot: { preserved: true } } });
    const publication = await db.emailPublication.create({ data: { senderKey: 'NOREPLY', purpose: 'NEWSLETTER_WELCOME', versionId: version.id } });
    const results = await Promise.all([service.importApprovedWelcomeDraft(), service.importApprovedWelcomeDraft()]);
    assert.equal(results.filter(r => r.created).length, 1);
    assert.equal(results[0].template.id, results[1].template.id);
    const imported = results[0].template;
    assert.deepEqual(imported.document, welcomeDocument());
    assert.equal(imported.subject, WELCOME_SUBJECT); assert.equal(imported.visualClassification, 'UNIQUE');
    assert.equal(imported.folderId, folder.id); assert.equal(imported.signatureMode, 'none');
    assert.equal(await db.emailTemplateVersion.count({ where: { templateId: imported.id } }), 0);
    assert.deepEqual(await db.emailPublication.findFirst(), publication);
    assert.deepEqual(await db.managedEmailTemplate.findUnique({ where: { id: original.id } }), original);
    assert.equal(await db.emailTemplateFolder.count(), 1);
    const edited = await db.managedEmailTemplate.update({ where: { id: imported.id }, data: { name: 'Edición conservada', subject: 'Personalizado', revision: { increment: 1 }, archivedAt: new Date() } });
    const repeated = await service.importApprovedWelcomeDraft();
    assert.equal(repeated.created, false); assert.deepEqual(repeated.template, edited);
    assert.equal(await db.auditLog.count({ where: { action: 'EMAIL_APPROVED_WELCOME_DRAFT_IMPORT' } }), 1);
    await db.managedEmailTemplate.update({ where: { id: imported.id }, data: { name: 'Bienvenida · Diseño aprobado', importKey: null } });
    await assert.rejects(() => service.importApprovedWelcomeDraft(), /Ya existe/);
    assert.equal(await db.managedEmailTemplate.count(), 2);
    assert.equal(await db.newsletterMailJob.count(), 0); assert.equal(await db.emailDelivery.count(), 0);
    console.log('PASS: explicit import; original canonical identity; concurrent idempotency; preserved edits/archive/publication; collision rejection; no email or business records.');
  } finally {
    if (db) await db.$disconnect();
    if (created) await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await control.end();
  }
}
main().catch(error => {
  console.error('WELCOME_DRAFT_IMPORT_TEST_FAILED: ' + String(error.message).replace(/postgres(?:ql)?:\/\/[^\s"']+/g, '[PRIVATE_DATABASE_URL]'));
  process.exitCode = 1;
});
