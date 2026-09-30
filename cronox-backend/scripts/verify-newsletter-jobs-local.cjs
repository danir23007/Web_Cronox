'use strict';
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { loadLocalEnvironment } = require('./start-local.cjs');

// This executable test never loads a deployment URL or a real mail transport.
const local = loadLocalEnvironment();
Object.assign(process.env, local);
const destination = new URL(process.env.DATABASE_URL);
if (destination.hostname !== '127.0.0.1' || destination.port !== '5433' || destination.pathname !== '/cronox_dev' ||
    process.env.EMAIL_ENABLED !== 'false' || process.env.BACKGROUND_JOBS_ENABLED !== 'false') {
  throw new Error('Isolated local database and disabled integrations are required');
}
const { PrismaClient } = require('@prisma/client');
const { NewsletterService } = require('../dist/newsletter/newsletter.service');
const { NewsletterDeliveryService } = require('../dist/newsletter/newsletter-delivery.service');
const { AuthService } = require('../dist/auth/auth.service');
const { EmailService } = require('../dist/email/email.service');

async function main() {
  const db = new PrismaClient();
  const suffix = randomBytes(6).toString('hex');
  const emails = ['new', 'legacy', 'retry', 'admin'].map(name => `newsletter-${name}-${suffix}@example.test`);
  const [newEmail, legacyEmail, retryEmail, adminEmail] = emails;
  const sent = [];
  let rejectWelcomeOnce = false;
  const fakeEmail = {
    isLaunchSenderConfigured: () => true,
    sendNewsletterWelcome: async (email, code) => {
      if (rejectWelcomeOnce) { rejectWelcomeOnce = false; throw new Error('controlled pre-SMTP rejection'); }
      sent.push({ kind: 'WELCOME', email, code });
    },
    sendNewsletterAccess: async (email, url, account) => sent.push({ kind: 'ACCESS', email, url, account }),
  };
  const service = new NewsletterService(db, fakeEmail);
  const worker = new NewsletterDeliveryService(db, fakeEmail);
  const previousJobs = process.env.BACKGROUND_JOBS_ENABLED;
  process.env.BACKGROUND_JOBS_ENABLED = 'true'; // Only this manually-created worker uses the fake sender.
  try {
    assert.equal(await db.newsletterMailJob.count({ where: { status: { in: ['QUEUED', 'PROCESSING'] } } }), 0,
      'Existing local jobs must not be processed by the test sender');
    const migration = await db.$queryRaw`SELECT finished_at, rolled_back_at FROM "_prisma_migrations"
      WHERE migration_name = '20260930120000_newsletter_mail_jobs'`;
    assert.equal(migration.length, 1);
    assert(migration[0].finished_at && !migration[0].rolled_back_at);
    const accepted = { status: 'accepted', httpStatus: 202 };
    const welcome = { ...accepted, confirmation: 'welcome' };
    const existing = { ...accepted, confirmation: 'existing_account' };
    const concurrent = await Promise.all([service.subscribe(newEmail), service.subscribe(newEmail)]);
    assert.deepEqual(concurrent.map(x => x.confirmation).sort(), ['subscribed', 'welcome']);
    assert.equal(await db.newsletterMailJob.count({ where: { email: newEmail, kind: 'WELCOME' } }), 1);
    assert.equal(sent.length, 0, 'HTTP 202 must not send synchronously');
    await worker.tick();
    assert.equal(sent.filter(x => x.kind === 'WELCOME' && x.email === newEmail).length, 1);
    assert((await db.newsletterSubscription.findUnique({ where: { email: newEmail } })).welcomeSentAt);

    const account = await db.user.create({ data: { email: newEmail, role: 'USER', accountState: 'ACTIVE', newsletterSubscribed: true } });
    assert.deepEqual(await service.subscribe(newEmail), existing);
    await Promise.all([service.subscribe(newEmail), service.requestAccess(newEmail)]);
    assert.equal(await db.newsletterMailJob.count({ where: { email: newEmail, kind: 'ACCESS' } }), 1);
    await worker.tick();
    const access = sent.find(x => x.kind === 'ACCESS' && x.email === newEmail);
    assert(access?.account);
    assert.equal(new URL(access.url).origin, new URL(process.env.FRONTEND_URL).origin);
    const token = new URL(access.url).hash.slice(1);
    const job = await db.newsletterMailJob.findFirst({ where: { email: newEmail, kind: 'ACCESS' } });
    assert.equal(job.tokenHash, createHash('sha256').update(token).digest('hex'));
    assert(!JSON.stringify(job).includes(token));

    const { AuthSessionsService } = require('../dist/auth/auth-sessions.service');
    const sessions = new AuthSessionsService(db);
    const auth = new AuthService({ toSafeUser: user => user }, {}, db, fakeEmail, service, sessions);
    await assert.rejects(auth.consumeNewsletterLink(token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')));
    const signedIn = await auth.consumeNewsletterLink(token);
    assert.equal(signedIn.user.id, account.id);
    assert.equal((await sessions.verify(signedIn.tokens.accessToken, 'access')).userId, account.id);
    const rotated = await sessions.rotate(signedIn.tokens.refreshToken);
    assert.equal((await sessions.verify(rotated.accessToken, 'access')).userId, account.id);
    await assert.rejects(auth.consumeNewsletterLink(token), 'a link is single-use');

    // Exercise the real landing page, auth controller and session cookies with
    // only SMTP replaced. This HTTP fixture never starts production jobs.
    await db.newsletterMailJob.updateMany({ where: { email: newEmail, kind: 'ACCESS' },
      data: { createdAt: new Date(Date.now() - 16 * 60_000) } });
    await service.requestAccess(newEmail);
    await worker.tick();
    const browserLink = sent.filter(x => x.kind === 'ACCESS' && x.email === newEmail).at(-1).url;
    const express = require('express');
    const { AuthController } = require('../dist/auth/auth.controller');
    const { chromium } = require('../../node_modules/@playwright/test');
    const controller = new AuthController(auth);
    const app = express();
    app.use(express.json());
    app.use(require('cookie-parser')());
    app.get('/api/auth/csrf', (_req, res) => res.json({ csrfToken: 'local-test-csrf' }));
    app.post('/api/auth/newsletter-login', async (req, res) => {
      if (req.headers['x-csrf-token'] !== 'local-test-csrf') return res.sendStatus(403);
      try { res.json(await controller.newsletterLogin(res, req.body)); }
      catch { res.status(401).json({ message: 'Invalid link' }); }
    });
    app.get('/', async (req, res) => {
      try { res.send(`Account ${(await sessions.verify(req.cookies.jwt, 'access')).userId}`); }
      catch { res.status(401).send('Anonymous'); }
    });
    app.use(express.static(path.resolve(__dirname, '../../cronox-front')));
    const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const origin = `http://127.0.0.1:${server.address().port}`;
      await page.goto(origin + new URL(browserLink).pathname + new URL(browserLink).hash);
      assert.equal((await page.context().cookies()).filter(c => c.name === 'jwt').length, 0);
      await page.getByRole('button', { name: 'Entrar en Cronox' }).click();
      await page.waitForURL(origin + '/');
      assert.equal(await page.locator('body').textContent(), `Account ${account.id}`);
      const cookies = await page.context().cookies();
      assert(cookies.find(c => c.name === 'jwt')?.httpOnly);
      assert(cookies.find(c => c.name === 'refresh_token')?.httpOnly);
      await assert.rejects(auth.consumeNewsletterLink(new URL(browserLink).hash.slice(1)));
    } finally {
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    }

    const expired = randomBytes(32).toString('hex');
    await db.newsletterMailJob.create({ data: { email: newEmail, kind: 'ACCESS', status: 'SENT', userId: account.id,
      tokenHash: createHash('sha256').update(expired).digest('hex'), tokenExpiresAt: new Date(Date.now() - 1_000) } });
    await assert.rejects(auth.consumeNewsletterLink(expired));
    const admin = await db.user.create({ data: { email: adminEmail, role: 'ADMIN', accountState: 'ACTIVE' } });
    const privileged = randomBytes(32).toString('hex');
    await db.newsletterMailJob.create({ data: { email: adminEmail, kind: 'ACCESS', status: 'SENT', userId: admin.id,
      tokenHash: createHash('sha256').update(privileged).digest('hex'), tokenExpiresAt: new Date(Date.now() + 60_000) } });
    await assert.rejects(auth.consumeNewsletterLink(privileged));

    await db.newsletterSubscription.create({ data: { email: legacyEmail, subscribedAt: new Date(), welcomeSentAt: new Date() } });
    assert.deepEqual(await service.subscribe(legacyEmail), { ...accepted, confirmation: 'subscribed' });
    await worker.tick();
    const registration = sent.find(x => x.kind === 'ACCESS' && x.email === legacyEmail);
    assert.equal(registration?.account, false);
    assert.equal(new URL(registration.url).searchParams.get('register'), '1');
    assert.equal(await db.user.count({ where: { email: legacyEmail } }), 0);
    const misbound = randomBytes(32).toString('hex');
    await db.newsletterMailJob.create({ data: { email: legacyEmail, kind: 'ACCESS', status: 'SENT', userId: account.id,
      tokenHash: createHash('sha256').update(misbound).digest('hex'), tokenExpiresAt: new Date(Date.now() + 60_000) } });
    await assert.rejects(auth.consumeNewsletterLink(misbound), 'a link cannot cross account email boundaries');

    rejectWelcomeOnce = true;
    assert.deepEqual(await service.subscribe(retryEmail), welcome);
    await worker.tick();
    let retryJob = await db.newsletterMailJob.findFirst({ where: { email: retryEmail } });
    assert.equal(retryJob.status, 'QUEUED');
    await db.newsletterMailJob.update({ where: { id: retryJob.id }, data: { readyAt: new Date(Date.now() - 1000) } });
    await worker.tick();
    retryJob = await db.newsletterMailJob.findUnique({ where: { id: retryJob.id } });
    assert.equal(retryJob.status, 'SENT');
    assert.equal(retryJob.attempts, 2);

    const stale = await db.newsletterMailJob.create({ data: { email: legacyEmail, kind: 'ACCESS', status: 'PROCESSING',
      claimedAt: new Date(Date.now() - 20 * 60_000), claimToken: 'local-stale-fixture' } });
    await worker.tick();
    assert.equal((await db.newsletterMailJob.findUnique({ where: { id: stale.id } })).status, 'UNCERTAIN');

    const previewTransport = { sendMail: async (_sender, options) => {
      assert.match(options.html, />Entrar en Cronox<\/a>/);
      const directory = path.resolve(__dirname, '../../test-results/newsletter-mail');
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, 'access.html'), options.html, 'utf8');
      return { messageId: 'local-preview', accepted: ['local@example.test'] };
    } };
    await new EmailService(previewTransport).sendNewsletterAccess('local@example.test',
      new URL('/newsletter-access.html#' + '0'.repeat(64), process.env.FRONTEND_URL).href, true);
    console.log(JSON.stringify({ destination: '127.0.0.1:5433/cronox_dev', accountConfirmationVerified: true,
      tested: ['concurrent', 'cooldown', 'retry', 'restart', 'valid', 'tampered', 'used', 'expired', 'misbound', 'privileged', 'no-account', 'browser-session-cookies', 'session-rotation'], externalEmailSent: false }));
  } finally {
    process.env.BACKGROUND_JOBS_ENABLED = previousJobs;
    await db.newsletterMailJob.deleteMany({ where: { email: { in: emails } } });
    await db.newsletterSubscription.deleteMany({ where: { email: { in: emails } } });
    await db.promoCode.deleteMany({ where: { ownerEmail: { in: emails } } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.$disconnect();
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
