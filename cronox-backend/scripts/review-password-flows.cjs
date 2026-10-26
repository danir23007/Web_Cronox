'use strict';
// Real HTTP/UI/auth in a disposable loopback DB. No real email transport.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path');
const { spawnSync, fork } = require('node:child_process'),
  { Client } = require('pg'),
  { randomUUID, randomBytes, createHash } = require('node:crypto');
const backend = path.resolve(__dirname, '..'),
  root = path.resolve(backend, '..'),
  sessionReview = process.argv.includes('--sessions'),
  sessionWorker = sessionReview && process.argv.includes('--session-worker'),
  bookReview = process.argv.includes('--book'),
  port = bookReview ? 43127 : sessionReview ? 43126 : 43125;
const name = sessionWorker ? process.env.CRONOX_REVIEW_SESSION_DATABASE : 'cronox_password_test_' + randomUUID().replace(/-/g, '');
assert.match(name, /^cronox_password_test_[a-f0-9]{32}$/);
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
    if (!sessionWorker) {
      await control.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
      created = true;
    }
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
      CORS_ORIGINS: `http://127.0.0.1:${port}` + (sessionReview ? ',https://cronox.es,https://www.cronox.es' : ''),
      EMAIL_ENABLED: 'false',
      BACKGROUND_JOBS_ENABLED: 'false',
      NEWSLETTER_EMAIL_WORKER_ENABLED: 'false',
      CRONOX_ROUTE_SMOKE_MODE: 'true',
      CRONOX_LOCAL_DEV: 'true',
      RATE_LIMIT_TTL_MS: '1000',
      RATE_LIMIT_MAX: '100',
    };
    const push = sessionWorker ? { status: 0 } : spawnSync(
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
      overrides,
    });
    const { PrismaService } = require('../dist/prisma/prisma.service');
    db = new PrismaService();
    await db.$connect();
    assert.equal(
      (await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,
      name,
    );
    if (!sessionWorker) {
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
    } finally {
      await setup.end();
    }
    }
    if (sessionReview && !sessionWorker) {
      // The parent owns the disposable DB. Each restart boots an entirely new
      // Node/Nest process with the same test keys and persistent session rows.
      const initial = randomBytes(12).toString('base64url');
      let restart = true;
      while (restart) {
        restart = false;
        const child = fork(__filename, ['--sessions', '--session-worker'], {
          cwd: backend, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          env: { ...process.env, CRONOX_REVIEW_SESSION_DATABASE: name, CRONOX_REVIEW_SESSION_PASSWORD: initial },
        });
        child.on('message', message => { if (message?.restart) restart = true; });
        const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
        assert.equal(code, 0, 'Disposable session worker failed');
      }
      return;
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
      { AppModule } = require('../dist/app.module'),
      { EmailService } = require('../dist/email/email.service');
    const runtime = path.join(root, 'test-results/password-flows/runtime');
    fs.mkdirSync(runtime, { recursive: true });
    process.chdir(runtime);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailService)
      .useValue(mail)
      .compile();
    app = module.createNestApplication({ logger: ['error'] });
    app.setGlobalPrefix('api');
    app.use(require('express').json({ limit: '100kb' }));
    app.use(require('express').urlencoded({ extended: true, limit: '100kb' }));
    app.use(require('cookie-parser')());
    app.use(
      require('../dist/common/config/local-review-safety').localReviewSafety,
    );
    const { ValidationPipe } = require('@nestjs/common');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.use((req, res, next) => {
      const token =
        req.cookies?.cronox_csrf_token || randomBytes(32).toString('base64url');
      req.csrfToken = token;
      if (!req.cookies?.cronox_csrf_token)
        res.cookie('cronox_csrf_token', token, { sameSite: 'lax', path: '/' });
      next();
    });
    const { AuthService } = require('../dist/auth/auth.service'),
      { NewsletterService } = require('../dist/newsletter/newsletter.service'),
      { KeyScreenService } = require('../dist/key-screen/key-screen.service');
    const auth = app.get(AuthService),
      newsletter = app.get(NewsletterService),
      keyScreen = app.get(KeyScreenService);
    const initial = sessionWorker ? process.env.CRONOX_REVIEW_SESSION_PASSWORD : randomBytes(12).toString('base64url');
    if (!sessionWorker || !await db.user.findUnique({ where: { email: 'normal@password.test' } })) {
    await auth.register({
      email: 'normal@password.test',
      password: initial,
      firstName: 'Local',
      lastName: 'Normal',
    });
    // Historical passwordless newsletter account, explicitly seeded as a fixture.
    // New subscriptions deliberately no longer create this kind of account.
    await db.user.create({ data: { email: 'newsletter@password.test', password: null, accountState: 'ACTIVE', registrationClaimable: true } });
    await newsletter.subscribe('newsletter@password.test');
    const screen = await db.keyScreen.create({
      data: {
        internalName: 'Disposable password preregistration',
        mode: 'PREREGISTRATION',
      },
    });
    await db.keyScreenSettings.create({
      data: { id: 'global', enabled: true, activeScreenId: screen.id },
    });
    await keyScreen.preregister('preregister@password.test');
    await db.keyScreenSettings.update({
      where: { id: 'global' },
      data: { enabled: false },
    });
    for (const kind of ['newsletter', 'preregister']) {
      const user = await db.user.findUniqueOrThrow({
        where: { email: kind + '@password.test' },
      });
      const raw = randomBytes(32).toString('hex');
      await db.preRegistration.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          launchTokenHash: createHash('sha256').update(raw).digest('hex'),
          launchTokenExpiresAt: new Date(Date.now() + 60000),
        },
        update: {
          launchTokenHash: createHash('sha256').update(raw).digest('hex'),
          launchTokenExpiresAt: new Date(Date.now() + 60000),
        },
      });
      await auth.consumeLaunchLink(raw);
    }
    // A guest account requiring its initial password must also be able to log in after reset.
    await db.$transaction((tx) =>
      app
        .get(
          require('../dist/orders/guest-order-account.service')
            .GuestOrderAccountService,
        )
        .resolveUserForCompletedOrder(tx, {
          userId: null,
          customerEmail: 'pending@password.test',
          shippingAddr: null,
          billingAddr: null,
        }),
    );
    }
    if (bookReview) await db.user.update({
      where: { email: 'normal@password.test' },
      data: { firstName: 'W'.repeat(120), lastName: 'W'.repeat(120), circleLevel: 3 },
    }); // Historical fixture in this disposable database only; never a repair.
    for (const kind of ['normal', 'newsletter', 'preregister', 'pending'])
      fixtures.set(
        kind,
        await db.user.findUniqueOrThrow({
          where: { email: kind + '@password.test' },
        }),
      );
    if (sessionReview) {
      const {
        AuthSessionsService,
      } = require('../dist/auth/auth-sessions.service');
      const sessions = app.get(AuthSessionsService);
      const { JwtService } = require('@nestjs/jwt');
      const jwt = new JwtService();
      const current = async (req) => {
        const claims = jwt.decode(
          req.cookies?.jwt || req.cookies?.refresh_token || '',
        );
        return claims?.sid
          ? db.authSession.findUnique({
              where: { id: claims.sid },
              include: { user: true },
            })
          : null;
      };
      app.use('/__review/session-state', async (req, res) => {
        const row = await current(req);
        res.json(
          row
            ? {
                id: row.id,
                issued: row.refreshIssuedAt,
                lastVisit: row.lastActivityAt,
                deadline: (row.refreshIssuedAt + 500 * 86400) * 1000,
                revoked: Boolean(row.revokedAt),
                role: row.user.role,
              }
            : { anonymous: true },
        );
      });
      app.use('/__review/session-age', async (req, res) => {
        const row = await current(req);
        if (!row) return res.sendStatus(404);
        const days = Number(req.body.days);
        assert.ok([1, 400, 501].includes(days));
        const aged = {
          ...row,
          refreshIssuedAt: Math.floor(Date.now() / 1000) - days * 86400,
          lastActivityAt: new Date(Date.now() - days * 86400_000),
        };
        // Only this isolated process can construct an aged, valid token family.
        await db.authSession.update({
          where: { id: row.id },
          data: {
            refreshIssuedAt: aged.refreshIssuedAt,
            lastActivityAt: aged.lastActivityAt,
            refreshHash: createHash('sha256')
              .update(sessions.refreshToken(aged, row.user.role))
              .digest('hex'),
            previousRefreshHash: null,
            previousValidUntil: null,
          },
        });
        if (days < 500)
          auth.setAuthCookies(res, sessions.tokens(aged, row.user.role));
        res.json({ ok: true });
      });
      app.use('/__review/access-expired', async (req, res) => {
        const row = await current(req);
        if (!row) return res.sendStatus(404);
        const seconds = Math.floor(Date.now() / 1000);
        res.cookie(
          'jwt',
          jwt.sign(
            {
              sub: row.userId,
              sv: row.sessionVersion,
              sid: row.id,
              type: 'access',
              iat: seconds - 1000,
              exp: seconds - 1,
            },
            {
              secret: process.env.JWT_ACCESS_SECRET,
              algorithm: 'HS256',
            },
          ),
          { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900000 },
        );
        res.json({ ok: true });
      });
      app.use('/__review/session-failure', (_req, res) => {
        const delegate = app.get(PrismaService).authSession;
        const original = delegate.findUnique.bind(delegate);
        delegate.findUnique = async (args) => {
          delegate.findUnique = original;
          throw new Error('Disposable simulated database outage');
        };
        res.json({ ok: true });
      });
      app.use('/__review/session-role', async (req, res) => {
        const row = await current(req);
        if (!row) return res.sendStatus(404);
        assert.ok(['USER', 'FRIEND'].includes(req.body.role));
        await db.user.update({
          where: { id: row.userId },
          data: { role: req.body.role },
        });
        res.json({ ok: true });
      });
    }
    app.use('/__review/session/:kind', async (req, res) => {
      const u = fixtures.get(req.params.kind);
      if (!u || u.accountState !== 'ACTIVE') return res.sendStatus(404);
      auth.setAuthCookies(
        res,
        await app
          .get(
            require('../dist/auth/auth-sessions.service').AuthSessionsService,
          )
          .create(u),
      );
      res.redirect('/profile.html');
    });
    app.use('/__review/fixture/:kind', (req, res) => {
      const u = fixtures.get(req.params.kind);
      if (!u) return res.sendStatus(404);
      res.json({
        email: u.email,
        initial: req.params.kind === 'normal' ? initial : undefined,
      });
    });
    app.use('/__review/mail/:kind', (req, res) => {
      const u = fixtures.get(req.params.kind),
        url = u && mails.get(u.email);
      if (!url) return res.sendStatus(404);
      res.json({ url });
    });
    app.use('/__review/check/:kind', async (req, res) => {
      const u = fixtures.get(req.params.kind);
      if (!u) return res.sendStatus(404);
      const current = await db.user.findUniqueOrThrow({ where: { id: u.id } });
      res.json({
        matches: Boolean(
          current.password &&
            typeof req.body.password === 'string' &&
            (await bcrypt.compare(req.body.password, current.password)),
        ),
        state: current.accountState,
        hasPassword: Boolean(current.password),
      });
    });
    app.use('/__review/expire/:kind', async (req, res) => {
      const u = fixtures.get(req.params.kind);
      if (!u) return res.sendStatus(404);
      await db.passwordResetToken.updateMany({
        where: { userId: u.id, usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      res.json({ ok: true });
    });
    app.use('/__review/expired/:kind', async (req, res) => {
      const u = fixtures.get(req.params.kind);
      if (!u) return res.sendStatus(404);
      const raw = randomBytes(32).toString('base64url');
      await db.passwordResetToken.create({
        data: {
          userId: u.id,
          token: createHash('sha256').update(raw).digest('hex'),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      res.json({
        url: `http://127.0.0.1:${port}/restablecer-contrasena#token=${encodeURIComponent(raw)}`,
      });
    });
    // Mirror the canonical routes used by generated email links, without logging URLs.
    if (sessionReview) {
      app.use(require('../dist/common/routing/public-seo').seoRequestSignals);
      const { CLEAN_PUBLIC_PAGES } = require('../dist/common/routing/public-pages');
      app.use((req, res, next) => {
        const file = CLEAN_PUBLIC_PAGES.get(req.path);
        if (!file || !['GET', 'HEAD'].includes(req.method)) return next();
        res.sendFile(path.join(root, 'cronox-front', file));
      });
    }
    app.use('/reset-password', (req, res) =>
      res.redirect(
        308,
        '/restablecer-contrasena' +
          (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''),
      ),
    );
    app.use('/restablecer-contrasena', (_req, res) =>
      res.sendFile(path.join(root, 'cronox-front/reset-password.html')),
    );
    app.use('/recuperar-contrasena', (_req, res) =>
      res.sendFile(path.join(root, 'cronox-front/forgot-password.html')),
    );
    app.use(require('express').static(path.join(root, 'cronox-front/public')));
    app.use(require('express').static(path.join(root, 'cronox-front')));
    let stopReview;
    const stopped = new Promise(resolve => { stopReview = resolve; });
    app.use('/__review/stop', (req, res) => {
      if (req.method !== 'POST') return res.sendStatus(405);
      res.json({ stopping: true });
      stopReview();
    });
    if (sessionWorker) app.use('/__review/restart', (req, res) => {
      if (req.method !== 'POST') return res.sendStatus(405);
      res.json({ restarting: true });
      process.send({ restart: true });
      stopReview();
    });
    if (sessionReview) app.use('/__review/process', (_req, res) => res.json({ pid: process.pid }));
    await app.listen(port, '127.0.0.1');
    console.log(
      JSON.stringify({
        ready: true,
        origin: `http://127.0.0.1:${port}`,
        emailTransport: 'in-memory',
        disposable: true,
      }),
    );
    const timeout = setTimeout(stopReview, 60 * 60_000);
    await Promise.race([stopped, new Promise((resolve) => {
      process.stdin.on('data', (chunk) => {
        if (String(chunk).includes('stop')) {
          process.stdin.pause();
          resolve();
        }
      });
    })]);
    clearTimeout(timeout);
  } finally {
    if (app) {
      // Browser APIRequest keep-alive connections must not keep a deliberately
      // stopped test process alive while the supervisor waits to replace it.
      const drain = setInterval(() => app.getHttpServer().closeAllConnections?.(), 50);
      try { await app.close(); } finally { clearInterval(drain); }
    }
    if (db) await db.$disconnect();
    if (created) {
      assert.match(name, /^cronox_password_test_[a-f0-9]{32}$/);
      await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await control.end();
    if (sessionWorker && process.connected) process.disconnect();
  }
  console.log(JSON.stringify({ cleanedUp: true }));
})().catch((error) => {
  console.error('LOCAL_PASSWORD_REVIEW_FAILED: ' + error.name);
  process.exitCode = 1;
});
