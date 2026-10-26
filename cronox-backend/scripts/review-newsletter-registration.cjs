'use strict';
// Real HTTP/UI/auth in a disposable loopback DB. No real email transport.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { spawnSync } = require('node:child_process'),
  { Client } = require('pg'),
  { randomUUID, randomBytes, createHash } = require('node:crypto');
const backend = path.resolve(__dirname, '..'),
  root = path.resolve(backend, '..'),
  port = 43128;
const name = 'cronox_newsletter_test_' + randomUUID().replace(/-/g, '');
(async () => {
  const env = require('./start-local.cjs').loadLocalEnvironment(),
    source = new URL(env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  const control = new Client({ connectionString: source.href });
  let created = false,
    db,
    app;
  try {
    await control.connect();
    assert.ok(
      ['127.0.0.1', '::1'].includes(
        (await control.query('SELECT host(inet_server_addr()) AS host')).rows[0]
          .host,
      ),
    );
    await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
    created = true;
    const target = new URL(source);
    target.pathname = '/' + name;
    target.search = '';
    const sql = new Client({ connectionString: target.href });
    await sql.connect();
    await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await sql.end();
    const overrides = {
      DATABASE_URL: target.href,
      DIRECT_URL: target.href,
      USER_NUMBERING_DATABASE_URL: target.href,
      FRONTEND_URL: `http://127.0.0.1:${port}`,
      API_PUBLIC_URL: `http://127.0.0.1:${port}`,
      CORS_ORIGINS: `http://127.0.0.1:${port}`,
      EMAIL_ENABLED: 'false',
      BACKGROUND_JOBS_ENABLED: 'false',
      NEWSLETTER_EMAIL_WORKER_ENABLED: 'false',
      CRONOX_ROUTE_SMOKE_MODE: 'true',
      CRONOX_LOCAL_DEV: 'true',
      RATE_LIMIT_TTL_MS: process.argv.includes('--concurrency') ? '60000' : '1000',
      RATE_LIMIT_MAX: '100',
    };
    const push = spawnSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'db',
        'push',
        '--skip-generate',
      ],
      {
        cwd: backend,
        env: { ...env, ...overrides },
        windowsHide: true,
        encoding: 'utf8',
      },
    );
    assert.equal(push.status, 0, 'Disposable schema initialization failed');
    require('../test/test-environment.cjs').installTestEnvironment({
      force: true, overrides,
    });
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    db = new PrismaService();
    await db.$connect();
    assert.equal(
      (await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,
      name,
    );
    await db.userNumberingState.create({
      data: { id: 1, nextId: 1, ready: true },
    });
    const migration = fs.readFileSync(
      path.join(
        backend,
        'prisma/migrations/20261008190000_consecutive_user_numbers/migration.sql',
      ),
      'utf8',
    );
    const setup = new Client({ connectionString: target.href });
    await setup.connect();
    try {
      if (process.argv.includes('--concurrency')) {
        // db push omits partial indexes. Exercise the production checkout fence.
        await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261013160000_bank_transfer_pending_reservation/migration.sql'), 'utf8').replace('DROP INDEX "CheckoutSnapshot_active_cart_key"', 'DROP INDEX IF EXISTS "CheckoutSnapshot_active_cart_key"'));
        // Exercise the actual new migration, including permissions, on empty fixtures.
        await setup.query('DROP TABLE "CartOperation", "RequestRateWindow"');
        await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261026180000_storefront_concurrency/migration.sql'), 'utf8'));
      }
      await setup.query(
        migration.slice(
          migration.indexOf('CREATE FUNCTION cronox_user_number_code'),
          migration.indexOf('CREATE FUNCTION cronox_user_number_plan'),
        ),
      );
      await setup.query(
        migration.slice(
          migration.indexOf('CREATE FUNCTION cronox_number_user()'),
          migration.indexOf('CREATE FUNCTION cronox_lock_user_deletion()'),
        ),
      );
      await setup.query(
        'CREATE TRIGGER "User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user()',
      );
      await setup.query(`
        CREATE TABLE review_failure (email text PRIMARY KEY, stage text NOT NULL);
        CREATE FUNCTION review_fail_write() RETURNS trigger AS $$ BEGIN
          IF EXISTS (SELECT 1 FROM review_failure WHERE email = NEW.email AND stage = TG_TABLE_NAME) THEN
            RAISE EXCEPTION 'Controlled persistence failure';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql;
        CREATE TRIGGER review_subscription_failure BEFORE INSERT OR UPDATE ON "NewsletterSubscription" FOR EACH ROW EXECUTE FUNCTION review_fail_write();
        CREATE TRIGGER review_welcome_failure BEFORE INSERT ON "NewsletterMailJob" FOR EACH ROW EXECUTE FUNCTION review_fail_write();
      `);
    } finally {
      await setup.end();
    }
    const mails = new Map(),
      fixtures = new Map(),
      bcrypt = require('bcrypt');
    const mail = {
      isEnabled: () => true,
      sendPasswordReset: async (email, url) => mails.set(email, url),
      sendInitialPasswordSetup: async (email, url) => mails.set(email, url),
    };
    const { Test } = require('@nestjs/testing'),
      { AppModule } = require('../src/app.module'),
      { EmailService } = require('../src/email/email.service');
    const runtime = path.join(root, 'output/playwright/newsletter-registration/runtime');
    fs.mkdirSync(runtime, { recursive: true });
    process.chdir(runtime);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(mail)
      .compile();
    app = module.createNestApplication({ logger: ['error'] });
    app.setGlobalPrefix('api');
    const { customerRequestDiagnostics, customerBodyParserError } = require('../src/common/customer-request-diagnostics');
    app.use(customerRequestDiagnostics);
    app.use(require('express').json({ limit: '100kb' }));
    app.use(require('express').urlencoded({ extended: true, limit: '100kb' }));
    app.use(customerBodyParserError);
    app.use(require('cookie-parser')());
    // This disposable database contains fixtures only. Real auth/CSRF/validation
    // guards remain installed. No historic-data review middleware is needed here.
    const { createAppValidationPipe } = require('../src/common/customer-validation');
    app.useGlobalPipes(createAppValidationPipe(true));
    app.use((req, res, next) => {
      const token =
        req.cookies?.cronox_csrf_token || randomBytes(32).toString('base64url');
      req.csrfToken = token;
      if (!req.cookies?.cronox_csrf_token)
        res.cookie('cronox_csrf_token', token, { sameSite: 'lax', path: '/' });
      next();
    });
    const { AuthService } = require('../src/auth/auth.service'),
      { NewsletterService } = require('../src/newsletter/newsletter.service'),
      { KeyScreenService } = require('../src/key-screen/key-screen.service');
    const auth = app.get(AuthService),
      newsletter = app.get(NewsletterService),
      keyScreen = app.get(KeyScreenService);
    const assertEmail = email => assert.match(email, /^[a-z0-9-]+@newsletter[.]test$/);
    let stopReview;
    app.use('/__review/stop', (_req, res) => { res.json({ stopping: true }); stopReview?.(); });
    const snapshot = async email => {
      assertEmail(email);
      const user = await db.user.findUnique({ where: { email } });
      const subscription = await db.newsletterSubscription.findUnique({ where: { email } });
      return { email, users: await db.user.count({ where: { email } }),
        subscriptions: await db.newsletterSubscription.count({ where: { email } }),
        subscriptionId: subscription?.id, consentAt: subscription?.subscribedAt,
        subscribed: Boolean(subscription?.subscribedAt), verified: Boolean(subscription?.verifiedAt),
        linked: Boolean(user && subscription?.userId === user.id),
        firstName: user?.firstName, hasPassword: Boolean(user?.password),
        newsletterSubscribed: user?.newsletterSubscribed,
        welcomes: await db.newsletterMailJob.count({ where: { email, kind: 'WELCOME' } }),
        accessMessages: await db.newsletterMailJob.count({ where: { email, kind: 'ACCESS' } }),
        codes: await db.promoCode.count({ where: { ownerEmail: email } }),
        passwordResetMessages: mails.has(email) ? 1 : 0,
      };
    };
    app.use('/__review/state', async (req, res) => {
      try { res.json(await snapshot(req.query.email)); } catch { res.sendStatus(400); }
    });
    app.use('/__review/fault', async (req, res) => {
      try {
        const { email, stage } = req.body; assertEmail(email);
        assert.ok([null, 'NewsletterSubscription', 'NewsletterMailJob'].includes(stage));
        if (stage) await db.$executeRaw`INSERT INTO review_failure(email, stage) VALUES (${email}, ${stage}) ON CONFLICT(email) DO UPDATE SET stage = EXCLUDED.stage`;
        else await db.$executeRaw`DELETE FROM review_failure WHERE email = ${email}`;
        res.json({ configured: true });
      } catch { res.sendStatus(400); }
    });
    app.use('/__review/seed', async (req, res) => {
      try {
        const { email, kind } = req.body; assertEmail(email);
        // Scenarios use distinct synthetic addresses. Do not reset shared
        // quotas; real auth/CSRF/rate guards remain active across scenarios.
        if (kind === 'existing') await auth.register({ email, firstName: 'Original', lastName: 'Persona', password: 'FixturePassword1!' });
        if (['subscribed', 'guest'].includes(kind)) await newsletter.subscribe(email);
        if (kind === 'guest') await db.$transaction(tx => app.get(require('../src/orders/guest-order-account.service').GuestOrderAccountService)
          .resolveUserForCompletedOrder(tx, { userId: null, customerEmail: email, shippingAddr: null, billingAddr: null }));
        res.json(await snapshot(email));
      } catch { res.sendStatus(400); }
    });
    if (process.argv.includes('--storefront-browser')) {
      await db.product.create({ data: { name: 'Local Concurrency Tee', slug: 'local-concurrency-tee', price: 2500,
        imageUrl: '/assets/customer-product-image-unavailable.svg',
        variants: { create: { size: 'M', sku: 'BROWSER-ONLY-M', stockQty: 1000 } } } });
      app.use('/__review/store-state', async (req, res) => {
        try {
          assertEmail(req.query.email);
          const user = await db.user.findUniqueOrThrow({ where: { email: req.query.email } });
          res.json({ cart: await db.cart.findUnique({ where: { userId: user.id }, include: { items: true } }), favorites: await db.favorite.findMany({ where: { userId: user.id } }) });
        } catch { res.sendStatus(400); }
      });
    }
    const { CLEAN_PUBLIC_PAGES, cleanPageForPath } = require('../src/common/routing/public-pages');
    app.use((req, res, next) => {
      const file = cleanPageForPath(req.path) || [...CLEAN_PUBLIC_PAGES.values()].find(value => req.path === '/' + value);
      if (req.method === 'GET' && file) {
        // Use the application's supported API-base configuration so this
        // browser review never falls back to the historical local database.
        const html = fs.readFileSync(path.join(root, 'cronox-front', file), 'utf8')
          .replace('<html ', `<html data-cronox-api-base="http://127.0.0.1:${port}" `);
        return res.type('html').set('Cache-Control', 'no-store').send(html);
      }
      next();
    });
    app.use(require('express').static(path.join(root, 'cronox-front/public')));
    app.use(require('express').static(path.join(root, 'cronox-front')));
    await app.listen(port, '127.0.0.1');
    console.log(JSON.stringify({ ready: true, origin: `http://127.0.0.1:${port}`, emailTransport: 'in-memory', workers: false, disposable: true }));
    if (process.argv.includes('--concurrency')) {
      await require('./review-storefront-concurrency.cjs')({ app, db, auth, origin: `http://127.0.0.1:${port}`, root });
    } else await new Promise(resolve => {
      const timeout = setTimeout(resolve, 30 * 60_000);
      stopReview = () => { clearTimeout(timeout); resolve(); };
      process.stdin.on('data', chunk => { if (String(chunk).includes('stop')) { process.stdin.pause(); stopReview(); } });
    });
  } finally {
    if (app) {
      const drain = setInterval(() => app.getHttpServer().closeAllConnections?.(), 50);
      try { await app.close(); } finally { clearInterval(drain); }
    }
    if (db) await db.$disconnect();
    if (created) {
      assert.match(name, /^cronox_newsletter_test_[a-f0-9]{32}$/);
      await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await control.end();
  }
  console.log(JSON.stringify({ cleanedUp: true }));
})().catch(error => { console.error('LOCAL_NEWSLETTER_REVIEW_FAILED: ' + error.name + ': ' + error.message); process.exitCode = 1; });
