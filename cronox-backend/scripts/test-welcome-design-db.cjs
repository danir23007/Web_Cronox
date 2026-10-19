'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const report = { checks: [], realMailSent: false, sourceDatabaseWrites: false, cleanedUp: false };
async function main() {
  const environment = loadLocalEnvironment();
  const source = new URL(environment.DATABASE_URL);
  assert.equal(source.host, '127.0.0.1:5433'); ensureLocalPostgres(environment);
  const name = 'cronox_welcome_test_' + randomUUID().replace(/-/g, '');
  assert.match(name, /^cronox_welcome_test_[a-f0-9]{32}$/);
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
    try { await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); }
    finally { await setup.end(); }
    const pushed = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', 'prisma/schema.prisma'], { cwd: backend, env: environment, windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(pushed.status, 0, 'Disposable schema initialization failed');
    const { PrismaClient } = require('@prisma/client');
    const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
    const { welcomeDocument, welcomeData, WELCOME_SUBJECT } = require('../dist/email/managed/welcome-design');
    db = new PrismaClient({ datasources: { db: { url: target.href } } });
    const messages = [];
    const transport = { sendMail: async (_key, payload) => { messages.push(payload); return { messageId: 'STUB-ONLY', accepted: ['fixture@example.invalid'] }; } };
    let service = new ManagedMailService(db, transport);
    await db.emailSenderProfile.create({ data: { key: 'NOREPLY' } });
    for (const [id, name] of [['first', 'Círculo 1'], ['second', 'Círculo 2']]) await db.emailTemplateFolder.create({ data: { id, name, senderKey: 'NOREPLY' } });
    const input = { name: 'Bienvenida', purpose: 'NEWSLETTER_WELCOME', folderId: 'first', subject: WELCOME_SUBJECT, preheader: '', signatureMode: 'none', document: { blocks: [{ type: 'text', text: '{{message}}' }] } };
    const original = await service.save('NOREPLY', input);
    const sibling = await service.save('NOREPLY', { ...input, folderId: 'second' });
    const beforeSibling = await service.template('NOREPLY', sibling.id);
    let saved = await service.save('NOREPLY', { ...input, document: welcomeDocument(), visualClassification: 'UNIQUE', revision: original.revision }, undefined, original.id);
    await db.$disconnect();
    db = new PrismaClient({ datasources: { db: { url: target.href } } }); service = new ManagedMailService(db, transport);
    saved = await service.template('NOREPLY', saved.id);
    assert.deepEqual(saved.document, welcomeDocument()); assert.equal(saved.visualClassification, 'UNIQUE');
    assert.deepEqual(await service.template('NOREPLY', sibling.id), beforeSibling);
    report.checks.push('Save/disconnect/reopen preserves approved HTML format, blue classification and other-circle isolation');
    for (const [code, included] of [['PERSONAL-CUSTOMER-92', true]]) {
      const rendered = await service.render('NOREPLY', saved, welcomeData(code), true);
      assert.ok(rendered.html.includes('Ya formas')); assert.equal(rendered.html.includes('10%'), included);
      assert.equal(rendered.text.includes('Un solo uso'), included); assert.ok(rendered.text.includes('La cara B del ser humano'));
      assert.ok(!/BIENVENIDA10|CRX-EJEMPLO|CÓDIGO DE EJEMPLO/.test(rendered.html + rendered.text));
    }
    report.checks.push('Real managed render includes only supplied personal code and blocks missing-code rendering before transport; plaintext includes approved copy/links');
    await assert.rejects(async () => service.render('NOREPLY', saved, { message: 'Missing code' }, true), /personal/);
    const published = await service.action('NOREPLY', saved.id, { action: 'publish', revision: saved.revision, confirmed: true });
    const active = await service.published('NOREPLY', 'NEWSLETTER_WELCOME', welcomeData('PERSONAL-CUSTOMER-92'));
    assert.ok(active.html.includes('Ya formas')); assert.ok(active.html.includes('PERSONAL-CUSTOMER-92'));
    const { EmailService } = require('../dist/email/email.service');
    const productionMessages = [];
    const production = new EmailService({ sendMail: async (sender, payload) => { productionMessages.push({ sender, ...payload }); return { messageId: 'PRODUCTION-STUB-ONLY', accepted: ['fixture@example.invalid'] }; } }, service);
    production.config.enabled = true;
    await production.sendNewsletterWelcome('fixture@example.invalid', 'PERSONAL-CUSTOMER-92');
    assert.equal(productionMessages.length, 1);
    assert.equal(productionMessages[0].html, active.html);
    assert.equal(productionMessages[0].text, active.text);
    assert.equal(productionMessages[0].subject, WELCOME_SUBJECT);
    assert.ok(!productionMessages[0].inReplyTo && !productionMessages[0].references);
    const version = await db.emailTemplateVersion.findFirstOrThrow({ where: { templateId: saved.id } });
    assert.deepEqual(version.snapshot.document, welcomeDocument());
    report.checks.push('Actual publication/snapshot resolution in disposable DB keeps the HTML email instead of adapting to the generic design');
    await service.save('NOREPLY', { ...input, document: { ...welcomeDocument(), blocks: [{ ...welcomeDocument().blocks[0], html: welcomeDocument().blocks[0].html.replace('Ya formas', 'Edición posterior') }] }, revision: published.revision }, undefined, saved.id);
    assert.ok((await service.published('NOREPLY', 'NEWSLETTER_WELCOME', welcomeData('PERSONAL-CUSTOMER-92'))).html.includes('Ya formas'));
    assert.ok(!(await service.published('NOREPLY', 'NEWSLETTER_WELCOME', welcomeData('PERSONAL-CUSTOMER-92'))).html.includes('Edición posterior'));
    assert.deepEqual(await db.emailTemplateVersion.findUniqueOrThrow({ where: { id: version.id } }), version);
    report.checks.push('Draft edits do not change the frozen published HTML/document/history');
    const current = await service.template('NOREPLY', saved.id);
    await service.action('NOREPLY', saved.id, { action: 'restoreVersion', revision: current.revision, versionId: version.id });
    assert.deepEqual((await service.template('NOREPLY', saved.id)).document, welcomeDocument());
    const local = await service.test('NOREPLY', saved.id, 'fixture@example.invalid', true);
    assert.equal(local.localOnly, true); assert.ok(local.html.includes('10%')); assert.ok(local.html.includes('VISTA-PREVIA-NO-VALIDO')); assert.equal(messages.length, 0);
    process.env.CRONOX_LOCAL_DEV = 'false';
    service.metadata = () => [{ key: 'NOREPLY', configured: true }];
    await assert.rejects(() => service.test('NOREPLY', saved.id, 'fixture@example.invalid', true), /WELCOME_PERSONAL_CODE_UNAVAILABLE/);
    assert.equal(messages.length, 0);
    const owner = await db.user.create({ data: { email: 'fixture@example.invalid', firstOrderDiscountCode: 'PERSONAL-CUSTOMER-92' } });
    await db.promoCode.create({ data: { code: owner.firstOrderDiscountCode, ownerUserId: owner.id, ownerEmail: owner.email, type: 'PERCENT', value: 10, firstOrderOnly: true, usageLimit: 1 } });
    await service.test('NOREPLY', saved.id, owner.email, true);
    assert.equal(messages.length, 1); assert.ok(messages[0].html.includes(owner.firstOrderDiscountCode)); assert.ok(messages[0].html.includes('10%'));
    assert.ok(!/VISTA-PREVIA|ABC234/.test(messages[0].html + messages[0].text));
    assert.equal(messages[0].subject, '[PRUEBA] ' + WELCOME_SUBJECT);
    report.checks.push('Version restore preserves format; local test never calls transport; stubbed external-test path never includes fictitious promo codes');
    // The operator-only controlled test is a separate explicit sample capability.
    // Exercise its actual durable once-only claim in PostgreSQL, never SMTP.
    Object.assign(process.env, { CRONOX_LOCAL_DEV: 'true', BACKGROUND_JOBS_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false', NEWSLETTER_EMAIL_WORKER_ENABLED: 'false', WAITLIST_EMAIL_WORKER_ENABLED: 'false' });
    const actor = await db.user.create({ data: { email: 'operator@example.invalid', role: 'SUPERADMIN' } });
    await db.managedEmailTemplate.update({ where: { id: saved.id }, data: { importKey: 'NOREPLY:1:NEWSLETTER_WELCOME' } });
    const controlledDraft = await service.template('NOREPLY', saved.id);
    const controlledOptions = { requestKey: 'welcome-draft-test:disposable-concurrent-fixture', revision: controlledDraft.revision, subjectId: 'isolated-fixture-20261019' };
    const businessBefore = { users: await db.user.findMany(), promos: await db.promoCode.findMany(), jobs: await db.newsletterMailJob.findMany() };
    const previousMessages = messages.length;
    const requests = await Promise.allSettled(Array.from({ length: 2 }, () => service.test('NOREPLY', saved.id, 'fixture@example.invalid', true, actor.id, controlledOptions)));
    assert.equal(requests.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(messages.length, previousMessages + 1);
    assert.ok(messages.at(-1).html.includes('VISTA-PREVIA-NO-VALIDO')); assert.ok(messages.at(-1).text.includes('VISTA-PREVIA-NO-VALIDO'));
    assert.equal(messages.at(-1).subject, '[PRUEBA isolated-fixture-20261019] ' + WELCOME_SUBJECT);
    await assert.rejects(() => service.test('NOREPLY', saved.id, 'fixture@example.invalid', true, actor.id, { ...controlledOptions, subjectId: 'bad\r\nSubject' }), /REQUIRES_ISOLATED/);
    await assert.rejects(() => service.test('NOREPLY', saved.id, 'fixture@example.invalid', true, actor.id, controlledOptions), /ALREADY_ATTEMPTED/);
    assert.equal(messages.length, previousMessages + 1);
    assert.deepEqual({ users: await db.user.findMany(), promos: await db.promoCode.findMany(), jobs: await db.newsletterMailJob.findMany() }, businessBefore);
    await assert.rejects(() => service.test('NOREPLY', saved.id, 'fixture@example.invalid', false, actor.id, controlledOptions), /REQUIRES_ISOLATED/);
    process.env.MAILBOX_WORKER_ENABLED = 'true';
    await assert.rejects(() => service.test('NOREPLY', saved.id, 'fixture@example.invalid', true, actor.id, controlledOptions), /REQUIRES_ISOLATED/);
    process.env.MAILBOX_WORKER_ENABLED = 'false';
    await assert.rejects(() => service.test('NOREPLY', saved.id, 'fixture@example.invalid', true, actor.id, { ...controlledOptions, requestKey: 'welcome-draft-test:changed-revision-fixture', revision: 99999 }), /DRAFT_CHANGED/);
    // An ambiguous outcome permanently spends the request key too.
    const uncertainService = new ManagedMailService(db, { sendMail: async () => { throw Object.assign(Error('SIMULATED_UNKNOWN'), { deliveryUnknown: true }); } });
    uncertainService.metadata = () => [{ key: 'NOREPLY', configured: true }];
    const uncertain = { ...controlledOptions, requestKey: 'welcome-draft-test:uncertain-outcome-fixture' };
    await assert.rejects(() => uncertainService.test('NOREPLY', saved.id, 'fixture@example.invalid', true, actor.id, uncertain));
    await assert.rejects(() => uncertainService.test('NOREPLY', saved.id, 'fixture@example.invalid', true, actor.id, uncertain), /ALREADY_ATTEMPTED/);
    report.checks.push('Explicit isolated operator sample test: exactly one send under concurrent calls/replay, fictitious code, no business mutations, paused-worker and revision guards, ambiguous attempt never repeated');
  } finally {
    if (db) await db.$disconnect();
    if (created) { await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end();
    const destination = path.resolve(backend, '../test-results/welcome-approved/database.json');
    fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
