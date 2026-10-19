'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { Client } = require('pg');
const backend = path.resolve(__dirname, '..');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
async function main() {
  const environment = loadLocalEnvironment();
  const url = new URL(environment.DATABASE_URL);
  assert.equal(url.host, '127.0.0.1:5433'); assert.equal(url.pathname, '/cronox_dev');
  assert.equal(environment.EMAIL_ENABLED, 'false'); assert.equal(environment.BACKGROUND_JOBS_ENABLED, 'false');
  ensureLocalPostgres(environment); Object.assign(process.env, environment);
  const { PrismaClient } = require('@prisma/client');
  const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
  const { welcomeDocument, WELCOME_SUBJECT } = require('../dist/email/managed/welcome-design');
  const db = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } });
  const service = new ManagedMailService(db, new Proxy({}, { get() { throw new Error('MAIL_FORBIDDEN'); } }));
  const reportDir = path.resolve(backend, '../test-results/welcome-approved'); fs.mkdirSync(reportDir, { recursive: true });
  const lock = new Client({ connectionString: environment.DATABASE_URL });
  await lock.connect();
  await lock.query("SELECT pg_advisory_lock(hashtext('welcome-local-integration'))");
  try {
    const before = await db.managedEmailTemplate.findMany({ orderBy: { id: 'asc' } });
    const publications = await db.emailPublication.findMany({ orderBy: [{ senderKey: 'asc' }, { purpose: 'asc' }] });
    // Resolve the imported identity, never all templates sharing a visible name.
    const target = await db.managedEmailTemplate.findUnique({ where: { importKey: 'NOREPLY:1:NEWSLETTER_WELCOME' } });
    assert.ok(target && target.senderKey === 'NOREPLY' && target.purpose === 'NEWSLETTER_WELCOME' && !target.archivedAt, 'Expected existing Circle 1 welcome draft');
    assert.equal(await db.emailPublication.count({ where: { version: { templateId: target.id } } }), 0, 'The selected local draft must not be actively published');
    const backup = path.join(reportDir, 'original-draft.json');
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(target, null, 2));
    const { resolveMailCircle } = require('../dist/email/managed/mail-circle-folders');
    const folder = await db.$transaction(tx => resolveMailCircle(tx, 'NOREPLY', 'I'));
    const document = welcomeDocument();
    const unchanged = target.folderId === folder.id && target.name === 'Bienvenida · Diseño aprobado' && target.visualClassification === 'UNIQUE' && target.subject === WELCOME_SUBJECT && target.signatureMode === 'none' && isDeepStrictEqual(target.document, document);
    const saved = unchanged ? target : await service.save('NOREPLY', { name: 'Bienvenida · Diseño aprobado', folderId: folder.id, purpose: 'NEWSLETTER_WELCOME', subject: WELCOME_SUBJECT, preheader: '', signatureMode: 'none', document, visualClassification: 'UNIQUE', revision: target.revision }, undefined, target.id);
    const rendered = await service.render('NOREPLY', saved);
    if (saved.html !== rendered.html || saved.text !== rendered.text) {
      await db.$transaction(async tx => {
        const changed = await tx.managedEmailTemplate.updateMany({ where: { id: saved.id, revision: saved.revision }, data: { html: rendered.html, text: rendered.text, revision: { increment: 1 } } });
        assert.equal(changed.count, 1, 'Draft changed while refreshing its render cache');
        await tx.auditLog.create({ data: { action: 'EMAIL_DRAFT_RENDER_REFRESH', actionType: 'EMAIL_DRAFT_RENDER_REFRESH', targetType: 'EMAIL_TEMPLATE', targetId: saved.id } });
      });
    }
    const reopened = await service.template('NOREPLY', saved.id);
    assert.deepEqual(reopened.document, document); assert.equal(reopened.visualClassification, 'UNIQUE');
    assert.equal(reopened.signatureMode, 'none'); assert.equal(reopened.subject, WELCOME_SUBJECT);
    const assets = JSON.parse(fs.readFileSync(path.resolve(backend, '../cronox-front/assets/mail/welcome/manifest.json'), 'utf8'));
    for (const [name, asset] of Object.entries({ ...assets.assets, ...assets.derivatives })) {
      if (!await db.emailAsset.findFirst({ where: { senderKey: 'NOREPLY', storageKey: asset.storageKey } }))
        await db.emailAsset.create({ data: { senderKey: 'NOREPLY', name, alt: name === 'fondo-cortinas.png' ? 'Fondo continuo de cortinas sin texto' : name.replace('.png', ''), ...Object.fromEntries(['url','storageKey','mimeType','fileSize','width','height'].map(key => [key, asset[key]])) } });
    }
    const after = await db.managedEmailTemplate.findMany({ orderBy: { id: 'asc' } });
    assert.deepEqual(after.filter(t => t.id !== target.id), before.filter(t => t.id !== target.id));
    assert.deepEqual(await db.emailPublication.findMany({ orderBy: [{ senderKey: 'asc' }, { purpose: 'asc' }] }), publications);
    const report = { id: saved.id, senderKey: saved.senderKey, folder: folder.name, name: saved.name, purpose: saved.purpose, subject: saved.subject, visualClassification: saved.visualClassification, documentSha256: createHash('sha256').update(JSON.stringify(document)).digest('hex'), otherTemplatesUnchanged: before.length - 1, publicationsUnchanged: true, automaticCopies: 0, mailSent: false, jobsEnabled: false };
    fs.writeFileSync(path.join(reportDir, 'integration.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally { await lock.query("SELECT pg_advisory_unlock(hashtext('welcome-local-integration'))"); await lock.end(); await db.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
