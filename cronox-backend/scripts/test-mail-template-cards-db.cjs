'use strict';
// Isolated real PostgreSQL. No writes to the source DB and no mail transport.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const report = { checks: [], cleanedUp: false, mailTransport: 'forbidden' };
const review = process.argv.includes('--review');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function main() {
  const env = loadLocalEnvironment();
  const source = new URL(env.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  ensureLocalPostgres(env);
  const dbName = 'cronox_mail_cards_test_' + randomUUID().replace(/-/g, '');
  assert.match(dbName, /^cronox_mail_cards_test_[a-f0-9]{32}$/);
  const controlUrl = new URL(source); controlUrl.search = '';
  const control = new Client({ connectionString: controlUrl.href });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cronox-mail-cards-'));
  let created = false, db, second;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${dbName}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + dbName; target.search = '?schema=public';
    Object.assign(env, { DATABASE_URL: target.href, DIRECT_URL: target.href, EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false' });
    Object.assign(process.env, env);
    const setupUrl = new URL(target); setupUrl.search = '';
    const setup = new Client({ connectionString: setupUrl.href });
    await setup.connect();
    try {
      await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      const baseline = fs.readFileSync(path.join(backend, 'prisma/schema.prisma'), 'utf8').replace(/^  visualClassification\s+.*\r?\n/gm, '');
      const baselinePath = path.join(temporary, 'baseline.prisma'); fs.writeFileSync(baselinePath, baseline);
      const pushed = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', baselinePath], { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
      assert.equal(pushed.status, 0, 'BASELINE_INITIALIZATION_FAILED');
      await setup.query(`INSERT INTO "EmailSenderProfile" (key,"updatedAt") VALUES ('ORDERS',now()),('INFO',now());
        INSERT INTO "EmailTemplateFolder" (id,"senderKey",name,"updatedAt") VALUES ('f1','ORDERS','Círculo I',now()),('f2','ORDERS','Círculo II',now()),('fi','INFO','Círculo I',now());
        INSERT INTO "ManagedEmailTemplate" (id,"senderKey","folderId",name,subject,document,html,text,"updatedAt") VALUES ('legacy','ORDERS','f1','Original','Original','{"blocks":[]}','original','original',now());
        REVOKE ALL ON "ManagedEmailTemplate" FROM PUBLIC`);
      const before = (await setup.query('SELECT row_to_json(t) AS data FROM "ManagedEmailTemplate" t WHERE id=\'legacy\'')).rows[0].data;
      await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261019090000_mail_template_visual_classification/migration.sql'), 'utf8'));
      await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261019100000_mail_template_private_metadata/migration.sql'), 'utf8'));
      const after = (await setup.query('SELECT row_to_json(t) AS data FROM "ManagedEmailTemplate" t WHERE id=\'legacy\'')).rows[0].data;
      const { visualClassification, ...original } = after; assert.equal(visualClassification, null); assert.deepEqual(original, before);
      await assert.rejects(setup.query(`UPDATE "ManagedEmailTemplate" SET "visualClassification"='RED' WHERE id='legacy'`), /visualClassification_check/);
      const privacy = (await setup.query(`SELECT relrowsecurity, relacl::text FROM pg_class WHERE relname='ManagedEmailTemplate'`)).rows[0];
      assert.equal(privacy.relrowsecurity, true); assert.ok(!/anon|authenticated|\{=/.test(privacy.relacl || ''));
      report.checks.push('Additive migration preserves every legacy value, leaves classification null, enforces three values and preserves private RLS/grants');
    } finally { await setup.end(); }
    const { PrismaClient } = require('@prisma/client');
    const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
    db = new PrismaClient({ datasources: { db: { url: target.href } } });
    second = new PrismaClient({ datasources: { db: { url: target.href } } });
    const forbiddenTransport = new Proxy({}, { get() { throw new Error('REAL_MAIL_FORBIDDEN'); } });
    const service = new ManagedMailService(db, forbiddenTransport);
    const dto = (row, extra = {}) => ({ name: row.name, subject: row.subject, preheader: row.preheader || '', folderId: row.folderId, purpose: row.purpose || undefined, document: row.document, signatureMode: 'none', revision: row.revision, ...extra });
    const input = { name: 'Igual nombre', subject: 'Mismo asunto', folderId: 'f1', preheader: '', purpose: 'ORDER_CONFIRMATION', document: { blocks: [{ type: 'text', text: 'Contenido intacto' }] }, signatureMode: 'none', visualClassification: 'FOR_ALL' };
    let a = await service.save('ORDERS', input);
    const b = await service.save('ORDERS', { ...input, folderId: 'f2', visualClassification: 'DIFFERENT' });
    const other = await service.save('INFO', { ...input, purpose: undefined, folderId: 'fi', visualClassification: 'UNIQUE' });
    const rendered = await service.render('ORDERS', a);
    a = await service.save('ORDERS', dto(a, { visualClassification: 'UNIQUE' }), undefined, a.id);
    assert.deepEqual(await service.render('ORDERS', a), rendered);
    assert.equal((await second.managedEmailTemplate.findUniqueOrThrow({ where: { id: a.id } })).visualClassification, 'UNIQUE');
    assert.equal((await service.template('ORDERS', b.id)).visualClassification, 'DIFFERENT');
    assert.equal((await service.template('INFO', other.id)).visualClassification, 'UNIQUE');
    await assert.rejects(service.template('INFO', a.id), /no encontrada/);
    report.checks.push('Create/edit persist across independent DB clients; circles and mailboxes stay isolated; render/subject/text unchanged');
    a = await service.save('ORDERS', dto(a, { subject: 'Editado' }), undefined, a.id);
    assert.equal(a.visualClassification, 'UNIQUE');
    let copy = await service.action('ORDERS', a.id, { action: 'duplicate', revision: a.revision });
    assert.equal(copy.visualClassification, 'UNIQUE');
    copy = await service.save('ORDERS', dto(copy, { visualClassification: 'FOR_ALL' }), undefined, copy.id);
    assert.equal((await service.template('ORDERS', a.id)).visualClassification, 'UNIQUE');
    let legacy = await service.template('ORDERS', 'legacy');
    const legacyHtml = legacy.html, legacyText = legacy.text;
    legacy = await service.save('ORDERS', dto(legacy, { visualClassification: 'DIFFERENT' }), undefined, legacy.id);
    assert.equal(legacy.html, legacyHtml); assert.equal(legacy.text, legacyText);
    // A separate truly unclassified record still stays null on unrelated edits.
    legacy = await db.managedEmailTemplate.create({ data: { senderKey: 'ORDERS', folderId: 'f1', name: 'Sin clasificar', subject: 'Heredado', document: { blocks: [] }, html: 'legacy', text: 'legacy' } });
    legacy = await service.save('ORDERS', dto(legacy, { subject: 'Edición heredada' }), undefined, legacy.id);
    assert.equal(legacy.visualClassification, null);
    assert.equal((await service.action('ORDERS', legacy.id, { action: 'duplicate', revision: legacy.revision })).visualClassification, null);
    for (const value of ['RED', '', null]) await assert.rejects(service.save('ORDERS', { ...input, visualClassification: value }), /clasificaciones/);
    report.checks.push('Unrelated edits and duplication preserve assigned/null values; invalid values rejected by service and database');
    a = await service.template('ORDERS', a.id);
    const synced = await service.saveDrafts('ORDERS', a.id, { ...dto(a, { visualClassification: 'FOR_ALL' }), targets: [{ id: a.id, revision: a.revision }, { id: b.id, revision: b.revision }] });
    a = synced.template;
    assert.equal(a.visualClassification, 'FOR_ALL'); assert.equal((await service.template('ORDERS', b.id)).visualClassification, 'DIFFERENT');
    report.checks.push('Explicit multi-circle content save changes classification on source only');
    const version = await db.emailTemplateVersion.create({ data: { templateId: a.id, snapshot: a } });
    await db.emailPublication.create({ data: { senderKey: 'ORDERS', purpose: 'ORDER_CONFIRMATION', versionId: version.id } });
    const publicationBefore = await db.emailPublication.findMany();
    const draftBefore = await service.template('ORDERS', a.id);
    assert.equal((await service.deletion('ORDERS', a.id)).canDelete, false);
    await assert.rejects(service.action('ORDERS', a.id, { action: 'archive', revision: a.revision, confirmed: true }), /publicada/);
    await assert.rejects(service.deleteFolder('ORDERS', 'f1', { mode: 'archive', destinationId: 'f2' }), /canónicas/);
    assert.deepEqual(await service.template('ORDERS', a.id), draftBefore); assert.deepEqual(await db.emailPublication.findMany(), publicationBefore);
    a = await service.action('ORDERS', a.id, { action: 'unpublish', revision: a.revision, confirmed: true });
    assert.equal(await db.emailPublication.count(), 0); assert.equal(await db.emailTemplateVersion.count(), 1);
    report.checks.push('Published archive is blocked atomically without revision/content/publication changes; explicit unpublish preserves immutable version');
    const box = await db.mailbox.create({ data: { name: 'Fixture', address: 'info@fixture.invalid', fromName: 'Fixture', provider: 'test', imapHost: 'localhost', smtpHost: 'localhost', username: 'fixture' } });
    const draft = await db.mailboxDraft.create({ data: { mailboxId: box.id, userId: 999, mode: 'campaign' } });
    const campaignData = templateId => ({ draftId: draft.id, draftRevision: Math.floor(Math.random() * 100000000), requestKey: randomUUID(), scheduledAt: new Date(Date.now() + 3600000), snapshot: { versions: [{ templateId }] } });
    const pending = await db.mailboxCampaign.create({ data: campaignData(a.id) });
    assert.equal((await service.deletion('ORDERS', a.id)).pendingCampaigns, 1);
    await assert.rejects(service.action('ORDERS', a.id, { action: 'archive', revision: a.revision, confirmed: true }), /campaña/);
    assert.equal((await db.mailboxCampaign.findUniqueOrThrow({ where: { id: pending.id } })).status, 'SCHEDULED');
    await db.mailboxCampaign.update({ where: { id: pending.id }, data: { status: 'COMPLETED', completedAt: new Date() } });
    await db.mailboxCampaignDelivery.create({ data: { campaignId: pending.id, email: 'historical@fixture.invalid', messageId: 'historical-fixture', status: 'SENT', content: { templateId: a.id, text: 'Frozen historical message' } } });
    const summary = await service.deletion('ORDERS', a.id); assert.equal(summary.canDelete, true); assert.equal(summary.versionCount, 1);
    await assert.rejects(service.action('ORDERS', a.id, { action: 'archive', revision: a.revision }), /Confirma/);
    const results = await Promise.allSettled([service.action('ORDERS', a.id, { action: 'archive', revision: a.revision, confirmed: true }), service.action('ORDERS', a.id, { action: 'archive', revision: a.revision, confirmed: true })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    const list = await service.list('ORDERS', { page: 1, limit: 100, sort: 'updatedAt' });
    assert.ok(!list.items.some(item => item.id === a.id)); assert.ok(list.items.some(item => item.id === b.id));
    assert.equal(await db.emailTemplateVersion.count(), 1); assert.deepEqual((await db.emailTemplateVersion.findUniqueOrThrow({ where: { id: version.id } })).snapshot, version.snapshot);
    assert.equal(await db.mailboxCampaign.count(), 1);
    assert.equal(await db.mailboxCampaignDelivery.count({ where: { status: 'SENT' } }), 1);
    assert.equal(await db.auditLog.count({ where: { action: 'EMAIL_ARCHIVE', targetId: a.id } }), 1);
    assert.ok(await db.auditLog.count({ where: { action: 'EMAIL_CLASSIFICATION_CHANGE', targetId: a.id } }));
    const folders = await service.folders('ORDERS'); assert.equal(folders.find(folder => folder.id === 'f1')._count.templates, await db.managedEmailTemplate.count({ where: { folderId: 'f1', archivedAt: null } }));
    report.checks.push('Pending snapshot reference blocks deletion; completed campaign and immutable version survive; concurrent archive has one winner/audit; lists and counts hide only selected id');
    // Exercise the exact FOR SHARE / revision-claim order used when scheduling.
    const held = deferred(), release = deferred();
    const scheduling = second.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ManagedEmailTemplate" WHERE id=${copy.id} FOR SHARE`;
      held.resolve(); await release.promise;
      return tx.mailboxCampaign.create({ data: campaignData(copy.id) });
    }, { isolationLevel: 'RepeatableRead', timeout: 10000 });
    await held.promise;
    const deleting = service.action('ORDERS', copy.id, { action: 'archive', revision: copy.revision, confirmed: true });
    const rejected = assert.rejects(deleting, /campaña/);
    release.resolve(); await scheduling; await rejected;
    assert.equal((await service.template('ORDERS', copy.id)).archivedAt, null);
    report.checks.push('Real scheduling share lock vs archive claim race preserves active template and pending campaign');
    const family = await db.campaignTemplateFamily.create({ data: { name: 'Familia aislada', eventKind: 'GENERAL' } });
    const sibling = await service.save('INFO', { ...input, folderId: 'fi', purpose: undefined, visualClassification: 'DIFFERENT' });
    const linked = await service.linkCampaignVersion('INFO', family.id, 1, { templateId: other.id, revision: other.revision });
    await service.linkCampaignVersion('INFO', family.id, 2, { templateId: sibling.id, revision: sibling.revision });
    await service.action('INFO', linked.id, { action: 'archive', revision: linked.revision, confirmed: true });
    assert.equal((await db.campaignTemplateFamily.findUniqueOrThrow({ where: { id: family.id } })).id, family.id);
    assert.equal((await service.template('INFO', sibling.id)).archivedAt, null);
    assert.ok(!(await service.campaignFamilies('INFO')).available.some(t => t.id === linked.id));
    report.checks.push('Archiving an idle family version keeps the family/other circle intact and removes the version from available new-use templates');
    const winner = await service.save('ORDERS', input);
    const claimed = deferred(), finishArchive = deferred(), schedulingStarted = deferred();
    const originalDeletion = service.deletion.bind(service);
    service.deletion = async (key, id, tx) => {
      if (id === winner.id && tx) { claimed.resolve(); await finishArchive.promise; }
      return originalDeletion(key, id, tx);
    };
    const winningArchive = service.action('ORDERS', winner.id, { action: 'archive', revision: winner.revision, confirmed: true });
    await claimed.promise;
    const staleSchedule = second.$transaction(async tx => {
      schedulingStarted.resolve();
      await tx.$queryRaw`SELECT id FROM "ManagedEmailTemplate" WHERE id=${winner.id} FOR SHARE`;
      const fresh = await tx.managedEmailTemplate.findUniqueOrThrow({ where: { id: winner.id } });
      if (fresh.archivedAt) throw new Error('ARCHIVED_TEMPLATE_NOT_AVAILABLE');
      await tx.mailboxCampaign.create({ data: campaignData(winner.id) });
    }, { isolationLevel: 'RepeatableRead', timeout: 10000 });
    const staleRejected = assert.rejects(staleSchedule);
    await schedulingStarted.promise; finishArchive.resolve(); await winningArchive; await staleRejected;
    service.deletion = originalDeletion;
    assert.equal((await originalDeletion('ORDERS', winner.id)).pendingCampaigns, 0);
    assert.ok((await service.template('ORDERS', winner.id)).archivedAt);
    report.checks.push('Inverse archive-vs-schedule race rejects the obsolete schedule without creating a pending campaign');
    const legacyReference = await db.mailboxCampaign.create({ data: { ...campaignData('unrelated'), status: 'PROCESSING', snapshot: { templateId: sibling.id } } });
    assert.equal((await service.deletion('INFO', sibling.id)).pendingCampaigns, 1);
    await db.mailboxCampaign.update({ where: { id: legacyReference.id }, data: { snapshot: {}, versions: { create: { fingerprint: 'frozen', content: { templateId: sibling.id } } } } });
    assert.equal((await service.deletion('INFO', sibling.id)).pendingCampaigns, 1);
    assert.equal((await originalDeletion('ORDERS', winner.id)).pendingCampaigns, 0);
    assert.equal(await db.emailDelivery.count(), 0);
    report.checks.push('Legacy and shared frozen campaign references are detected by exact id; unrelated templates stay independent; zero real email deliveries');
    if (review) {
      await db.userNumberingState.upsert({ where: { id: 1 }, update: { ready: true }, create: { id: 1, nextId: 2, ready: true } });
      await db.user.create({ data: { id: 1, email: 'admin@mail-cards.test', role: 'SUPERADMIN', password: await require('bcrypt').hash('Local-review-only-2026!', 10), firstName: 'Revisión', lastName: 'Local' } });
      await db.user.create({ data: { id: 2, email: 'user@mail-cards.test', role: 'USER', password: await require('bcrypt').hash('Local-review-only-2026!', 10) } });
      for (const [name, classification] of [['Para todos los círculos', 'FOR_ALL'], ['Especial de este círculo', 'UNIQUE'], ['Contenido por círculo', 'DIFFERENT'], ['Diseño heredado sin clasificar', undefined]]) {
        await service.save('ORDERS', { ...input, name, visualClassification: classification });
      }
      // Actual Nest server, normal cookies/auth, real templates API and static admin.
      Object.assign(process.env, { PORT: '43129', HOST: '127.0.0.1', FRONTEND_URL: 'http://127.0.0.1:43129', API_PUBLIC_URL: 'http://127.0.0.1:43129', CORS_ORIGINS: 'http://127.0.0.1:43129', CRONOX_ROUTE_SMOKE_MODE: 'true' });
      require('../dist/main');
      console.log('MAIL_CARD_REVIEW http://127.0.0.1:43129/admin.html (disposable DB; email/jobs off). Finish with GET http://127.0.0.1:43130/done');
      await new Promise(resolve => {
        const cleanup = require('node:http').createServer((req, res) => {
          if (req.url !== '/done') { res.writeHead(404).end(); return; }
          res.end('Closing disposable review'); cleanup.close(); resolve();
        });
        cleanup.listen(43130, '127.0.0.1');
      });
    }
    await db.$disconnect(); db = null; await second.$disconnect(); second = null;
  } finally {
    if (db) await db.$disconnect(); if (second) await second.$disconnect();
    if (created) { await control.query(`DROP DATABASE "${dbName}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end();
    const resolvedTemporary = path.resolve(temporary);
    assert.equal(path.dirname(resolvedTemporary), path.resolve(os.tmpdir()), 'TEMP_CLEANUP_MUST_STAY_IN_OS_TEMP');
    assert.match(path.basename(resolvedTemporary), /^cronox-mail-cards-[a-zA-Z0-9]+$/);
    fs.rmSync(resolvedTemporary, { recursive: true, force: true });
    const destination = path.resolve(backend, '../test-results/mail-template-cards/results.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
main().then(() => { if (review) process.exit(0); }).catch(error => { console.error(error); process.exitCode = 1; });
