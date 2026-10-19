'use strict';
// Explicit one-off operator action. No Nest application/worker is started.
// SMTP is reached only with --send, using ManagedMailService.test and the
// existing audited/quota-limited transport. A durable request key forbids replay.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const to = option('--to');
const key = option('--request-key');
const subjectId = option('--test-id');
assert.ok(subjectId === undefined || /^[a-zA-Z0-9-]{6,50}$/.test(subjectId), 'Invalid test subject identifier');
assert.match(to || '', /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/);
assert.match(key || '', /^[a-zA-Z0-9-]{8,70}$/);
assert.equal(['--prepare', '--send', '--status'].filter(flag => process.argv.includes(flag)).length, 1, 'Choose --prepare, --send or --status');
const requestKey = 'welcome-draft-test:' + key;
const directory = path.resolve(backend, '../test-results/welcome-real-test', key);
const planFile = path.join(directory, 'plan.json');
const resultFile = path.join(directory, 'result.json');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function main() {
  const environment = loadLocalEnvironment();
  assert.equal(new URL(environment.DATABASE_URL).host, '127.0.0.1:5433');
  assert.equal(new URL(environment.DATABASE_URL).pathname, '/cronox_dev');
  assert.equal(environment.DATABASE_URL, environment.DIRECT_URL);
  assert.equal(environment.EMAIL_ENABLED, 'false');
  assert.equal(environment.BACKGROUND_JOBS_ENABLED, 'false');
  Object.assign(environment, { MAILBOX_WORKER_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false', NEWSLETTER_EMAIL_WORKER_ENABLED: 'false', WAITLIST_EMAIL_WORKER_ENABLED: 'false' });
  Object.assign(process.env, environment);
  const { PrismaClient } = require('@prisma/client');
  const { ManagedMailService } = require('../dist/email/managed/managed-mail.service');
  const { MailTransportFactory } = require('../dist/email/mail-transport.factory');
  const { mailPreviewData } = require('../dist/email/managed/welcome-design');
  const { compileMailMessage } = require('../dist/email/mail-message');
  const { inspectWelcomeMime } = require('./inspect-welcome-mime.cjs');
  const db = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } });
  let transport;
  try {
    assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name, 'cronox_dev');
    const actor = await db.user.findUniqueOrThrow({ where: { email: environment.LOCAL_ADMIN_EMAIL || 'admin@cronox.local' }, select: { id: true, role: true } });
    assert.equal(actor.role, 'SUPERADMIN');
    const template = await db.managedEmailTemplate.findUniqueOrThrow({ where: { importKey: 'NOREPLY:1:NEWSLETTER_WELCOME' }, include: { folder: true } });
    assert.equal(template.senderKey, 'NOREPLY'); assert.equal(template.folder.name, 'Círculo 1');
    assert.equal(template.name, 'Bienvenida · Diseño aprobado'); assert.equal(template.archivedAt, null);
    assert.equal(template.purpose, 'NEWSLETTER_WELCOME'); assert.equal(template.visualClassification, 'UNIQUE');
    assert.equal(await db.emailPublication.count({ where: { version: { templateId: template.id } } }), 0);
    const service = new ManagedMailService(db, {});
    const rendered = await service.render('NOREPLY', template, mailPreviewData(template.purpose), true);
    assert.ok(rendered.html.includes('VISTA-PREVIA-NO-VALIDO') && rendered.text.includes('VISTA-PREVIA-NO-VALIDO'));
    assert.ok(rendered.html.includes('10%')); assert.ok(!/CRX-EJEMPLO|BIENVENIDA10|CÓDIGO DE EJEMPLO/.test(rendered.html + rendered.text));
    const subject = '[PRUEBA' + (subjectId ? ' ' + subjectId : '') + '] ' + rendered.subject;
    const existing = await db.auditLog.findUnique({ where: { requestKey } });
    if (process.argv.includes('--status') || existing) {
      const deliveries = await db.emailDelivery.findMany({ where: { recipient: to, subject, purpose: 'ADMIN_TEST', ...(existing ? { createdAt: { gte: existing.createdAt } } : { id: '__none__' }) }, select: { id: true, status: true, providerMessageId: true, errorCode: true, createdAt: true } });
      console.log(JSON.stringify({ requestKey, attempted: Boolean(existing), automaticReplayBlocked: Boolean(existing), from: 'no-reply@cronox.es', to, subject, deliveries }, null, 2));
      return;
    }
    const plan = { requestKey, from: 'no-reply@cronox.es', to, subject, templateId: template.id, revision: template.revision,
      documentSha256: hash(template.document), renderedSha256: hash(rendered), sampleCode: 'VISTA-PREVIA-NO-VALIDO',
      actorId: actor.id, workersPaused: true, database: '127.0.0.1:5433/cronox_dev', publications: 0 };
    fs.mkdirSync(directory, { recursive: true });
    if (process.argv.includes('--prepare')) {
      const compiled = await compileMailMessage('CRONOX <no-reply@cronox.es>', { to, subject, html: rendered.html, text: rendered.text });
      const inspection = await inspectWelcomeMime(compiled.raw, { ...rendered, to, subject });
      fs.writeFileSync(planFile, JSON.stringify(plan, null, 2));
      fs.writeFileSync(path.join(directory, 'preview.html'), rendered.html);
      fs.writeFileSync(path.join(directory, 'preview.txt'), rendered.text);
      fs.writeFileSync(path.join(directory, 'preview.eml'), compiled.raw);
      fs.writeFileSync(path.join(directory, 'mime-preview.json'), JSON.stringify(inspection, null, 2));
      console.log(JSON.stringify({ ...plan, prepared: true, smtpAttempts: 0, mime: inspection }, null, 2));
      return;
    }
    assert.deepEqual(plan, JSON.parse(fs.readFileSync(planFile, 'utf8')), 'Prepared draft/recipient changed; prepare and review again before sending');
    const credentials = require('dotenv').parse(fs.readFileSync(path.join(backend, '.env')));
    for (const name of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_NOREPLY_USER', 'SMTP_NOREPLY_PASS', 'SMTP_NOREPLY_DAILY_LIMIT', 'SMTP_NOREPLY_HOURLY_LIMIT', 'EMAIL_DEFAULT_FROM_NAME', 'EMAIL_NOREPLY_FROM_NAME']) {
      if (credentials[name] !== undefined) process.env[name] = credentials[name];
    }
    assert.equal(process.env.SMTP_NOREPLY_USER?.toLowerCase(), plan.from);
    assert.ok(process.env.SMTP_NOREPLY_PASS, 'No-reply credentials unavailable');
    assert.equal(process.env.SMTP_SECURE, 'true', 'Controlled test requires TLS');
    assert.equal(process.env.EMAIL_SMTP_PAUSED === 'true', false, 'SMTP is paused; retain that protection');
    process.env.EMAIL_ENABLED = 'true'; // This isolated process only; no env file/server is changed.
    transport = new MailTransportFactory(db);
    let sentMime;
    const deliver = transport.deliverAttempt.bind(transport);
    // Passive inspection of the exact raw bytes compiled by the real factory.
    // Preserve the existing durable attempt, quotas, deadline and SMTP method.
    transport.deliverAttempt = async (id, senderKey, prepared, deadline) => {
      assert.ok(!sentMime, 'One MIME delivery only');
      sentMime = await inspectWelcomeMime(prepared.raw, { ...rendered, to, subject });
      fs.writeFileSync(path.join(directory, 'sent.eml'), prepared.raw);
      fs.writeFileSync(path.join(directory, 'sent-mime.json'), JSON.stringify(sentMime, null, 2));
      return deliver(id, senderKey, prepared, deadline);
    };
    const controlledService = new ManagedMailService(db, transport);
    const businessState = async () => ({
      users: await db.user.findMany({ orderBy: { id: 'asc' }, select: { id: true, email: true, firstOrderDiscountCode: true, firstOrderDiscountUsed: true } }),
      orders: await db.order.findMany({ orderBy: { id: 'asc' } }),
      promos: await db.promoCode.findMany({ orderBy: { id: 'asc' } }),
      discounts: await db.discountCode.findMany({ orderBy: { id: 'asc' } }),
      benefits: await db.accountWelcomeBenefit.findMany({ orderBy: { id: 'asc' } }),
      jobs: await db.newsletterMailJob.findMany({ orderBy: { id: 'asc' } }),
      subscriptions: await db.newsletterSubscription.findMany({ orderBy: { id: 'asc' } }),
      templates: await db.managedEmailTemplate.findMany({ orderBy: { id: 'asc' } }),
      versions: await db.emailTemplateVersion.findMany({ orderBy: { id: 'asc' } }),
      publications: await db.emailPublication.findMany({ orderBy: [{ senderKey: 'asc' }, { purpose: 'asc' }] }),
    });
    const before = hash(await businessState());
    const beforeDeliveries = await db.emailDelivery.findMany({ select: { id: true } });
    // Disk sentinel protects crash/relaunch before the durable application claim.
    fs.writeFileSync(path.join(directory, 'send-started.json'), JSON.stringify({ requestKey, at: new Date().toISOString() }), { flag: 'wx' });
    let response, failed = false;
    try { response = await controlledService.test('NOREPLY', template.id, to, true, actor.id, { requestKey, revision: plan.revision, ...(subjectId ? { subjectId } : {}) }); }
    catch { failed = true; } // Inspect the durable outcome; never retry SMTP here.
    const deliveries = await db.emailDelivery.findMany({ where: { id: { notIn: beforeDeliveries.map(row => row.id) } }, select: { id: true, senderKey: true, recipient: true, subject: true, purpose: true, status: true, providerMessageId: true, errorCode: true } });
    assert.ok(deliveries.length <= 1, 'Unexpected multiple delivery attempts');
    for (const row of deliveries) { assert.equal(row.senderKey, 'NOREPLY'); assert.equal(row.recipient, to); assert.equal(row.subject, subject); assert.equal(row.purpose, 'ADMIN_TEST'); }
    const unchanged = before === hash(await businessState());
    const outcome = deliveries[0]?.status || 'NO_SMTP_ATTEMPT';
    const report = { from: transport.getFrom('NOREPLY'), to, subject, requestKey, templateId: template.id, revision: plan.revision,
      sampleCode: plan.sampleCode, outcome, deliveryAttempts: deliveries.length, deliveries,
      providerMessageId: response?.messageId || deliveries[0]?.providerMessageId || null,
      businessDataUnchanged: unchanged, workersPaused: true, automaticRetry: false,
      inboxDeliveryConfirmed: false, serviceReturnedError: failed };
    report.mime = sentMime || null;
    report.smtpMessageIdMatchesMime = Boolean(sentMime && sentMime.messageId === report.providerMessageId);
    fs.writeFileSync(resultFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    assert.ok(unchanged, 'Business data changed during the controlled test');
    if (failed || outcome !== 'SMTP_ACCEPTED') process.exitCode = 1;
  } finally {
    if (transport) await transport.onModuleDestroy();
    await db.$disconnect();
  }
}
main().catch(() => { console.error('Prueba controlada detenida. Consulta el registro local; no repetir si existe un intento o resultado incierto. No se muestran credenciales.'); process.exitCode = 1; });
