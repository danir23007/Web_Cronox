'use strict';
// Real application, PostgreSQL, shared form and sessions; loopback fixtures only.
// Email is replaced before Nest is created. No production account or SMTP.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process'), { randomUUID, randomBytes } = require('node:crypto');
const { Client } = require('pg');
const backend = path.resolve(__dirname, '..'), root = path.resolve(backend, '..');
const report = { checks: [], smtp: 'simulated', cleanedUp: false };
async function main() {
  const configPath = process.env.CRONOX_EVENT_TEST_LOCAL_ENV || path.join(backend, '.env.local');
  const local = require('dotenv').parse(fs.readFileSync(configPath));
  const { buildLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
  const env = buildLocalEnvironment(local, process.env); ensureLocalPostgres(env);
  const source = new URL(env.DATABASE_URL); source.search = '';
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  const name = 'cronox_event_registration_test_' + randomUUID().replace(/-/g, '');
  assert.match(name, /^cronox_event_registration_test_[a-f0-9]{32}$/);
  const control = new Client({ connectionString: source.href });
  let created = false, db, app, browser;
  const port = 43136, url = `http://127.0.0.1:${port}`;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + name;
    Object.assign(env, { DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href,
      FRONTEND_URL: url, API_PUBLIC_URL: url, CORS_ORIGINS: url, EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false',
      MAILBOX_SEND_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false', NEWSLETTER_EMAIL_WORKER_ENABLED: 'false',
      WAITLIST_EMAIL_WORKER_ENABLED: 'false', CRONOX_LOCAL_DEV: 'true', CRONOX_ROUTE_SMOKE_MODE: 'true',
      RATE_LIMIT_TTL_MS: '1000', RATE_LIMIT_MAX: '100', CRONOX_ENV_FILE: configPath });
    const sql = new Client({ connectionString: target.href }); await sql.connect();
    await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); await sql.end();
    const push = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'],
      { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(push.status, 0, 'ISOLATED_SCHEMA_FAILED'); Object.assign(process.env, env);
    require('ts-node/register/transpile-only');
    const { PrismaService } = require('../src/prisma/prisma.service');
    db = new PrismaService(); await db.$connect();
    assert.equal((await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, name);
    await db.userNumberingState.create({ data: { id: 1, nextId: 1, ready: true } });
    const numbering = fs.readFileSync(path.join(backend, 'prisma/migrations/20261008190000_consecutive_user_numbers/migration.sql'), 'utf8');
    const setup = new Client({ connectionString: target.href }); await setup.connect();
    await setup.query(numbering.slice(numbering.indexOf('CREATE FUNCTION cronox_user_number_code'), numbering.indexOf('CREATE FUNCTION cronox_user_number_plan')));
    await setup.query(numbering.slice(numbering.indexOf('CREATE FUNCTION cronox_number_user()'), numbering.indexOf('CREATE FUNCTION cronox_lock_user_deletion()')));
    await setup.query('CREATE TRIGGER "User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user()');
    await setup.end();
    const deliveries = [];
    const email = { isEnabled: () => true, sendPasswordReset: async (to, link) => deliveries.push({ to, link }),
      sendInitialPasswordSetup: async (to, link) => deliveries.push({ to, link }),
      sendNewsletterWelcome: async () => { throw Error('BACKGROUND_DELIVERY_FORBIDDEN'); } };
    const { Test } = require('@nestjs/testing'), { AppModule } = require('../src/app.module');
    const { EmailService } = require('../src/email/email.service');
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(EmailService).useValue(email).compile();
    app = module.createNestApplication({ logger: ['error'] }); app.setGlobalPrefix('api');
    app.use(require('express').json()); app.use(require('cookie-parser')());
    app.useGlobalPipes(require('../src/common/customer-validation').createAppValidationPipe(true));
    app.use((req, res, next) => {
      const token = req.cookies.cronox_csrf_token || randomBytes(32).toString('base64url'); req.csrfToken = token;
      if (!req.cookies.cronox_csrf_token) res.cookie('cronox_csrf_token', token, { sameSite: 'lax', path: '/' }); next();
    });
    const { createPublicHtmlGateMiddleware } = require('../src/common/routing/public-html-gate.middleware');
    const { createSeoPages } = require('../src/common/routing/public-seo');
    app.use(createPublicHtmlGateMiddleware({ authService: { hasValidAdminSession: async () => false },
      keyScreen: { shouldGatePublicHtml: async () => true }, frontendRoot: path.join(root, 'cronox-front') }));
    app.use(createSeoPages(path.join(root, 'cronox-front'), { links: async () => [], product: async () => null }));
    app.use(require('express').static(path.join(root, 'cronox-front/public')));
    app.use(require('express').static(path.join(root, 'cronox-front')));
    await app.listen(port, '127.0.0.1');
    const { AuthService } = require('../src/auth/auth.service'), { AdminUsersService } = require('../src/admin/users/admin-users.service');
    const auth = app.get(AuthService), admin = app.get(AdminUsersService);
    const dto = (email, source = 'event') => ({ firstName: 'Persona', lastName: 'Prueba', email, password: 'SecurePassword1!', ...(source ? { registrationSource: source } : {}) });
    const fixture = 'mobile@event-registration.test';
    const { chromium } = require(path.join(root, 'node_modules/playwright'));
    browser = await chromium.launch({ headless: true });
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await mobile.addInitScript(base => { window.__CRONOX_API_BASE__ = base; }, url);
    const page = await mobile.newPage();
    page.on('pageerror', error => console.error('BROWSER_ERROR', error.message));
    page.on('console', message => { if (message.type() === 'error') console.error('BROWSER_CONSOLE', message.text()); });
    page.on('response', async response => { if (response.status() >= 400) console.log('HTTP_FAILURE', response.status(), response.url()); });
    await page.goto(url + '/registro-evento');
    await page.waitForLoadState('networkidle');
    await page.locator('#authRegisterForm.is-active').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.newsletter-modal-overlay').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#authRegisterFirstName').fill('Persona'); await page.locator('#authRegisterLastName').fill('Prueba');
    await page.locator('#authRegisterEmail').fill(fixture); await page.locator('#authRegisterPassword').fill('SecurePassword1!');
    await page.locator('#authRegisterForm button[type=submit]').click();
    try { await page.locator('#eventRegistrationComplete').waitFor({ state: 'visible', timeout: 20000 }); }
    catch (error) { console.error('FORM_STATE', await page.locator('#authRegisterForm').innerText()); throw error; }
    const user = await db.user.findUniqueOrThrow({ where: { email: fixture } });
    assert.equal(user.role, 'USER'); assert.equal(user.newsletterSubscribed, false);
    assert.equal(await db.newsletterSubscription.count({ where: { email: fixture } }), 0);
    const profile = await admin.getUserById(user.id); assert.equal(profile.user.observations, 'Usuario de evento');
    assert.equal(await db.adminNote.count({ where: { targetType: 'user', targetId: String(user.id), content: 'Usuario de evento' } }), 1);
    report.checks.push('Real mobile registration through shared UI, session and CSRF; USER role; exact persisted administrator observation; no marketing opt-in or popup; no overflow');
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await desktop.addInitScript(base => { window.__CRONOX_API_BASE__ = base; }, url);
    const desktopPage = await desktop.newPage(); await desktopPage.goto(url + '/registro-evento');
    await desktopPage.locator('#authRegisterForm.is-active').waitFor({ state: 'visible' });
    assert.equal(await desktopPage.locator('.newsletter-modal-overlay').count(), 0);
    await desktopPage.locator('[data-auth-switch=login]').click();
    await desktopPage.locator('#authLoginEmail').fill(fixture); await desktopPage.locator('#authLoginPassword').fill('SecurePassword1!');
    await desktopPage.locator('#authLoginForm button[type=submit]').click();
    await desktopPage.locator('#eventRegistrationComplete').waitFor({ state: 'visible' });
    assert.equal(await db.adminNote.count({ where: { targetType: 'user', targetId: String(user.id) } }), 1);
    report.checks.push('Desktop direct form and existing-account login reuse normal handlers without another event annotation');
    await assert.rejects(auth.register(dto(fixture))); assert.equal(await db.user.count({ where: { email: fixture } }), 1);
    const normal = await auth.register(dto('normal@event-registration.test', null));
    await db.adminNote.create({ data: { targetType: 'user', targetId: String(normal.user.id), content: 'Observación anterior' } });
    const before = await db.user.findUnique({ where: { id: normal.user.id } });
    await assert.rejects(auth.register(dto(normal.user.email)));
    await auth.login({ email: normal.user.email, password: 'SecurePassword1!' });
    const after = await db.user.findUnique({ where: { id: normal.user.id } });
    assert.equal(after.role, before.role); assert.equal(after.password, before.password);
    assert.equal((await admin.getUserById(normal.user.id)).user.observations, 'Observación anterior');
    report.checks.push('Normal registration unchanged; existing email and login leave account role, credentials and all previous observations intact');
    const concurrent = await Promise.allSettled([auth.register(dto('race@event-registration.test')), auth.register(dto('race@event-registration.test'))]);
    assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1);
    const raced = await db.user.findUniqueOrThrow({ where: { email: 'race@event-registration.test' } });
    assert.equal(await db.adminNote.count({ where: { targetType: 'user', targetId: String(raced.id) } }), 1);
    await db.adminNote.create({ data: { targetType: 'user', targetId: String(user.id), content: 'Otra observación conservada' } });
    await auth.requestPasswordReset(fixture);
    for (let i = 0; i < 100 && !deliveries.some(d => d.to === fixture); i++) await new Promise(resolve => setTimeout(resolve, 25));
    const captured = deliveries.find(d => d.to === fixture); assert.ok(captured);
    const token = new URLSearchParams(new URL(captured.link).hash.slice(1)).get('token');
    await auth.resetPassword(token, 'AnotherSecurePassword2!');
    const reread = await admin.getUserById(user.id);
    assert.equal(reread.user.observations, 'Usuario de evento\nOtra observación conservada');
    assert.equal((await db.user.findUnique({ where: { id: user.id } })).newsletterSubscribed, false);
    report.checks.push('Concurrent creation/retries produce one account and one annotation; attribution and other notes survive real persisted access-recovery verification with simulated email');
    const failureDb = new Client({ connectionString: target.href }); await failureDb.connect();
    await failureDb.query(`CREATE FUNCTION fail_event_note() RETURNS trigger AS $$ BEGIN
      IF NEW.content='Usuario de evento' AND EXISTS(SELECT 1 FROM "User" WHERE id=NEW."targetId"::integer AND email='failure@event-registration.test')
      THEN RAISE EXCEPTION 'controlled event observation failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER test_event_note_failure BEFORE INSERT ON "AdminNote" FOR EACH ROW EXECUTE FUNCTION fail_event_note()`);
    await assert.rejects(auth.register(dto('failure@event-registration.test')));
    assert.equal(await db.user.count({ where: { email: 'failure@event-registration.test' } }), 0); await failureDb.end();
    const rejected = await fetch(url + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(dto('csrf@event-registration.test')) });
    assert.equal(rejected.status, 403);
    report.checks.push('Observation failure rolls the account back atomically; registration still rejects missing CSRF');
    await mobile.close(); await desktop.close();
  } finally {
    if (browser) await browser.close(); if (app) await app.close(); if (db) await db.$disconnect();
    if (created) { await control.query(`DROP DATABASE "${name}" WITH (FORCE)`); report.cleanedUp = true; }
    await control.end();
    const output = path.join(root, 'output/event-registration/test-results.json');
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
