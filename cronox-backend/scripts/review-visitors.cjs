/* Isolated PostgreSQL + actual Nest/auth/visitor HTTP checks.
 * Never reads .env or touches production. --serve leaves synthetic UI data for browser review.
 * node cronox-backend/scripts/review-visitors.cjs [--serve]
 */
'use strict';
const fs = require('node:fs/promises'),
  path = require('node:path'),
  os = require('node:os'),
  net = require('node:net'),
  assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'),
  { randomUUID } = require('node:crypto');
const backend = path.resolve(__dirname, '..'),
  root = path.resolve(backend, '..'),
  pgBin =
    process.env.VISITOR_TEST_PG_BIN ||
    (process.platform === 'win32'
      ? 'C:/Program Files/PostgreSQL/17/bin'
      : '/usr/bin');
const exe = (name) =>
  path.join(pgBin, name + (process.platform === 'win32' ? '.exe' : ''));
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { windowsHide: true, stdio: 'pipe', ...opts });
const passes = [];
const pass = (name) => {
  passes.push(name);
  console.log('PASS: ' + name);
};
async function main() {
  const dir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'cronox-visitor-review-'),
    ),
    dbDir = path.join(dir, 'pg');
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const url = `postgresql://visitor_review@127.0.0.1:${port}/postgres`;
  assert.equal(new URL(url).hostname, '127.0.0.1');
  run(exe('initdb'), [
    '-D',
    dbDir,
    '-U',
    'visitor_review',
    '-A',
    'trust',
    '--encoding=UTF8',
    '--locale=C',
  ]);
  run(
    exe('pg_ctl'),
    [
      '-D',
      dbDir,
      '-l',
      path.join(dir, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ],
    { stdio: 'ignore' },
  );
  let db,
    app,
    smtp,
    stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    if (app) await app.close();
    if (db) await db.$disconnect();
    if (smtp) await new Promise((r) => smtp.close(r));
    run(exe('pg_ctl'), ['-D', dbDir, '-m', 'fast', '-w', 'stop']);
  };
  process.once('SIGINT', () => void stop().then(() => process.exit()));
  process.stdin.on('data', (data) => {
    if (String(data).trim() === 'stop') void stop().then(() => process.exit());
  });
  try {
    // Reconstruct the pre-migration schema without relying on a particular HEAD.
    const schema = (
      await fs.readFile(path.join(backend, 'prisma/schema.prisma'), 'utf8')
    )
      .replace(
        /model (?:Mailbox\w*|DailyVisitorBrowser|DailyVisitorLink) \{[\s\S]*?\n\}/g,
        '',
      )
      .replace(
        /^.*(?:deduplicationStartedAt|browserLinks DailyVisitorLink|disposition String|observedRole String).*\r?\n/gm,
        '',
      );
    const schemaFile = path.join(dir, 'before.prisma');
    await fs.writeFile(schemaFile, schema);
    const base = run(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'diff',
        '--from-empty',
        '--to-schema-datamodel',
        schemaFile,
        '--script',
      ],
      { cwd: dir, env: { ...process.env, DATABASE_URL: url } },
    );
    const baseFile = path.join(dir, 'base.sql');
    await fs.writeFile(
      baseFile,
      'CREATE EXTENSION IF NOT EXISTS pg_trgm;CREATE ROLE anon;CREATE ROLE authenticated;\n' +
        base,
    );
    const sql = (file) =>
      run(exe('psql'), [url, '-v', 'ON_ERROR_STOP=1', '-f', file]);
    sql(baseFile);
    const initialConfig = path.join(dir, 'initial-config.sql');
    await fs.writeFile(
      initialConfig,
      `INSERT INTO "VisitorHistoryConfig" VALUES (1, '2026-03-01T12:00:00Z');`,
    );
    sql(initialConfig);
    sql(
      path.join(
        backend,
        'prisma/migrations/20261002120000_permanent_visitor_finance_history/migration.sql',
      ),
    );
    sql(
      path.join(
        backend,
        'prisma/migrations/20261002200000_visitor_daily_reconciliation/migration.sql',
      ),
    );
    // Only in this newly initialized loopback database: keep the unrelated pending mail UI operational.
    const pendingMailMigration = path.join(
      backend,
      'prisma/migrations/20261002160000_admin_mailboxes/migration.sql',
    );
    try {
      await fs.access(pendingMailMigration);
      sql(pendingMailMigration);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.writeFile(path.join(dir, 'empty.env'), '');
    process.env.CRONOX_ENV_FILE = path.join(dir, 'empty.env');
    process.chdir(dir);
    require(
      path.join(backend, 'test/test-environment.cjs'),
    ).installTestEnvironment({
      force: true,
      overrides: {
        DATABASE_URL: url,
        CRONOX_ROUTE_SMOKE_MODE: 'true',
        EMAIL_ENABLED: 'false',
        BACKGROUND_JOBS_ENABLED: 'false',
        FRONTEND_URL: 'http://127.0.0.1:43123',
        API_PUBLIC_URL: 'http://127.0.0.1:43123',
        CORS_ORIGINS: 'http://127.0.0.1:43123',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
      },
    });
    for (const key of Object.keys(process.env))
      if (/^(SMTP_|MAILBOX_)/.test(key)) delete process.env[key];
    Object.assign(process.env, {
      MAILBOX_WORKER_ENABLED: 'false',
      MAILBOX_SEND_ENABLED: 'false',
      MAILBOX_TEST_PASS: 'synthetic-password-only',
      MAILBOX_ENCRYPTION_KEY_ID: 'local',
      MAILBOX_ENCRYPTION_KEYS: JSON.stringify({
        local: Buffer.alloc(32, 17).toString('base64'),
      }),
      MAILBOX_PRIVATE_DIR: path.join(dir, 'private'),
    });
    const runtimePath = require.resolve('@prisma/client/runtime/library.js'),
      runtime = require(runtimePath);
    require.cache[runtimePath].exports = new Proxy(runtime, {
      get(target, key) {
        if (key === 'warnEnvConflicts') return () => {};
        if (key === 'getPrismaClient')
          return (config) =>
            target.getPrismaClient({ ...config, relativeEnvPaths: {} });
        return Reflect.get(target, key);
      },
    });
    const { PrismaClient } = require('@prisma/client');
    db = new PrismaClient({ datasources: { db: { url } } });
    const { NestFactory } = require('@nestjs/core'),
      { ValidationPipe } = require('@nestjs/common');
    const { AppModule } = require(path.join(backend, 'dist/app.module'));
    assert.equal(
      Object.keys(process.env).filter((key) => /^SMTP_/.test(key)).length,
      0,
      'test must not load private SMTP environment',
    );
    app = await NestFactory.create(AppModule, { logger: ['error'] });
    app.setGlobalPrefix('api');
    app.use(require('cookie-parser')());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.use((_req, res, next) => {
      res.cookie('cronox_csrf_token', 'isolated-mailbox-csrf-000000000000', {
        sameSite: 'lax',
      });
      next();
    });
    // Inject the local API base before serving HTML; static assets remain actual repository files.
    app.use(async (req, res, next) => {
      if (req.method === 'GET' && req.path === '/') {
        return res.type('html')
          .send(`<!doctype html><meta charset="utf-8"><title>Isolated visitor review</title><button id="login">Login USER</button><button id="logout">Logout</button><button id="withdraw">Withdraw consent</button><p id="status">Ready</p><script>
          document.cookie='cronox_cookie_consent='+encodeURIComponent(JSON.stringify({version:'2',analytics:true}))+';path=/';
          window.CRONOX_API={API_BASE:'http://127.0.0.1:43123',getMe:async()=>null,getCsrfHeaders:async()=>({'x-csrf-token':'isolated-mailbox-csrf-000000000000'})};
          window.CRONOX_COOKIE_CONSENT={registerService:s=>{window.reviewService=s;s.load();}};
          document.querySelector('#login').onclick=async()=>{const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json',...await CRONOX_API.getCsrfHeaders()},body:JSON.stringify({email:'user@example.test',password:'Isolated-visitors-123!'})});document.querySelector('#status').textContent='Login '+r.status;window.dispatchEvent(new Event('cronox:userChanged'));};
          document.querySelector('#logout').onclick=async()=>{const r=await fetch('/api/auth/logout',{method:'POST',headers:await CRONOX_API.getCsrfHeaders()});document.querySelector('#status').textContent='Logout '+r.status;window.dispatchEvent(new Event('cronox:session-ended'));};
          document.querySelector('#withdraw').onclick=()=>{document.cookie='cronox_cookie_consent='+encodeURIComponent(JSON.stringify({version:'2',analytics:false}))+';path=/';reviewService.disable();};
          </script><script src="/assets/visitor-history.js?v=2"></script>`);
      }
      if (req.method === 'GET' && req.path === '/admin.html') {
        let html = await fs.readFile(
          path.join(root, 'cronox-front/admin.html'),
          'utf8',
        );
        res
          .type('html')
          .send(
            html.replace(
              '<head>',
              '<head><meta name="cronox:api-base" content="http://127.0.0.1:43123">',
            ),
          );
      } else next();
    });
    const { VisitorHistoryService } = require(
      path.join(backend, 'dist/analytics/visitor-history.service'),
    );
    const service = app.get(VisitorHistoryService);
    const { AuthSessionsService } = require(
      path.join(backend, 'dist/auth/auth-sessions.service'),
    );
    const sessions = app.get(AuthSessionsService);
    const users = {},
      tokens = {};
    for (const role of ['USER', 'FRIEND', 'ADMIN', 'SUPERADMIN']) {
      users[role] = await db.user.create({
        data: {
          email: role.toLowerCase() + '@example.test',
          name: 'Synthetic ' + role,
          role,
          password: await require('bcrypt').hash('Isolated-visitors-123!', 10),
        },
      });
      tokens[role] = await sessions.create(users[role]);
    }
    const consent = JSON.stringify({ version: '2', analytics: true });
    const at = (n) =>
      new Date('2026-09-' + String(n).padStart(2, '0') + 'T12:00:00Z');
    async function browser(now) {
      const req = { cookies: { cronox_cookie_consent: consent } };
      await service.session(
        req,
        {
          cookie: (name, value) => {
            req.cookies[name] = value;
          },
          clearCookie: () => {},
          setHeader: () => {},
        },
        now,
      );
      return req;
    }
    async function record(req, now, user) {
      req.user = user;
      return service.record(req, '/', undefined, now);
    }
    async function counts(now, auth, anon) {
      const day = now.toISOString().slice(0, 10),
        detail = await service.detail(day, 'all', '', 1),
        report = await service.report(day, day);
      assert.deepEqual(detail.totals, { authenticated: auth, anonymous: anon });
      assert.equal(detail.pagination.total, auth + anon);
      assert.deepEqual(report.buckets[0], {
        day,
        authenticated: auth,
        anonymous: anon,
      });
    }
    let b = await browser(at(1));
    await record(b, at(1));
    await service.bridge(b, users.USER, at(1));
    await counts(at(1), 1, 0);
    pass('anonymous -> server login USER');
    b = await browser(at(2));
    await record(b, at(2), users.USER);
    await record(b, at(2));
    await counts(at(2), 1, 0);
    pass('USER -> logout -> navigation');
    b = await browser(at(3));
    await record(b, at(3), users.USER);
    await record(b, at(3));
    await counts(at(3), 1, 0);
    pass('persistent session -> logout');
    b = await browser(at(4));
    await Promise.all(Array.from({ length: 20 }, () => record(b, at(4))));
    await counts(at(4), 0, 1);
    pass('anonymous concurrent reloads: one fact');
    const multi = await Promise.all(
      Array.from({ length: 4 }, () => browser(at(5))),
    );
    await Promise.all(multi.map((req) => record(req, at(5), users.USER)));
    await counts(at(5), 1, 0);
    pass('account across devices/concurrent workers');
    const anonBrowsers = await Promise.all(
      Array.from({ length: 4 }, () => browser(at(6))),
    );
    await Promise.all(anonBrowsers.map((req) => record(req, at(6))));
    await Promise.all(
      anonBrowsers.map((req) => service.bridge(req, users.USER, at(6))),
    );
    await counts(at(6), 1, 0);
    pass('four anonymous browsers -> same account');
    b = await browser(at(7));
    await record(b, at(7));
    await service.bridge(b, users.USER, at(7));
    await record(b, at(7));
    await service.bridge(b, users.FRIEND, at(7));
    await counts(at(7), 2, 0);
    pass('shared browser: two legitimate accounts');
    b = await browser(at(8));
    await record(b, at(8), users.ADMIN);
    await record(b, at(8), users.SUPERADMIN);
    await counts(at(8), 0, 0);
    pass('both administrator roles excluded');
    b = await browser(at(9));
    await record(b, at(9));
    await service.bridge(b, users.ADMIN, at(9));
    await record(b, at(9));
    await counts(at(9), 0, 0);
    pass('anonymous -> ADMIN -> logout suppression');
    b = await browser(at(10));
    await record(b, at(10), users.FRIEND);
    await service.bridge(b, users.ADMIN, at(10));
    await record(b, at(10));
    await counts(at(10), 1, 0);
    pass('admin on shared browser preserves FRIEND');
    b = await browser(at(11));
    await Promise.all([
      ...Array.from({ length: 20 }, () => record(b, at(11))),
      service.bridge(b, users.USER, at(11)),
      ...Array.from({ length: 20 }, () => record(b, at(11), users.USER)),
    ]);
    await counts(at(11), 1, 0);
    pass('conversion and anonymous/account requests atomic');
    b = await browser(at(12));
    await record(b, at(12), users.USER);
    await assert.rejects(record(b, at(13)), /SERVER_BROWSER_PROOF_REQUIRED/);
    b = await browser(at(13));
    await record(b, at(13));
    await counts(at(12), 1, 0);
    await counts(at(13), 0, 1);
    pass('Madrid next day resets classification');
    for (const [instant, expected] of [
      ['2026-03-28T23:00:00Z', '2026-03-29T22:00:00.000Z'],
      ['2026-10-24T22:00:00Z', '2026-10-25T23:00:00.000Z'],
    ]) {
      let expiry;
      await service.session(
        { cookies: { cronox_cookie_consent: consent } },
        {
          cookie: (_n, _v, o) => {
            expiry = o.expires.toISOString();
          },
          setHeader: () => {},
          clearCookie: () => {},
        },
        new Date(instant),
      );
      assert.equal(expiry, expected);
    }
    pass('Madrid DST: 23/25 hour cookie expiry');
    b = await browser(at(14));
    b.cookies.cronox_cookie_consent = JSON.stringify({
      version: '2',
      analytics: false,
    });
    assert.deepEqual(await record(b, at(14)), { accepted: false });
    await service.bridge(b, users.USER, at(14));
    await counts(at(14), 0, 0);
    let cleared = false;
    await service.session(
      b,
      {
        clearCookie: () => {
          cleared = true;
        },
        setHeader: () => {},
      },
      at(14),
    );
    assert(cleared);
    pass('missing/withdrawn consent: no facts or bridge');
    b = await browser(at(15));
    b.cookies.cronox_daily_visitor = '2026-09-15.' + 'a'.repeat(64);
    await assert.rejects(record(b, at(15)), /SERVER_BROWSER_PROOF_REQUIRED/);
    await counts(at(15), 0, 0);
    pass('forged browser proof cannot claim another visit');
    b = await browser(at(16));
    await record(b, at(16), users.USER);
    await db.user.update({
      where: { id: users.USER.id },
      data: { role: 'ADMIN' },
    });
    await counts(at(16), 1, 0);
    await db.user.update({
      where: { id: users.USER.id },
      data: { role: 'USER' },
    });
    pass('later role promotion preserves observed USER history');
    const oldDay = at(17);
    await db.$executeRaw`INSERT INTO "DailyVisitor" (id,day,category,identity,"userId","firstAt","lastAt") VALUES (${randomUUID()},'2026-09-17','anonymous','legacy-unknown',NULL,${oldDay},${oldDay}), (${randomUUID()},'2026-09-17','authenticated','legacy-admin-unknown',${users.ADMIN.id},${oldDay},${oldDay})`;
    await counts(oldDay, 1, 1);
    pass(
      'legacy unknown browser/role retained without fabricated reconciliation',
    );
    const raw = await db.$queryRawUnsafe(
      `SELECT disposition,COUNT(*)::int AS count FROM "DailyVisitor" WHERE day='2026-09-06' GROUP BY disposition`,
    );
    assert.equal(raw.find((r) => r.disposition === 'linked').count, 4);
    pass('original linked facts and relationship evidence preserved');
    const restarted = new VisitorHistoryService(db);
    b = await browser(at(18));
    await record(b, at(18), users.FRIEND);
    b.user = undefined;
    await restarted.record(b, '/', undefined, at(18));
    await counts(at(18), 1, 0);
    pass('classification survives service/backend restart');
    assert.equal(
      (await service.detail('2026-02-28', 'all', '', 1)).available,
      false,
    );
    assert.equal(
      (await service.report('2026-02-28', '2026-03-01')).buckets[0].anonymous,
      null,
    );
    pass('historic start unchanged; missing days stay null');
    const fallback = {
      cookies: { cronox_cookie_consent: consent },
      user: users.FRIEND,
    };
    const fallbackSession = await service.session(
      fallback,
      {
        setHeader: () => {},
        cookie: () => {
          throw Error('must not issue anonymous proof');
        },
      },
      at(19),
      false,
    );
    assert.equal(fallbackSession.browserReady, false);
    await service.record(fallback, '/', undefined, at(19));
    await counts(at(19), 1, 0);
    pass('verified account without browser proof/Web Locks remains countable');
    const workerFile = path.join(dir, 'worker.cjs');
    await fs.writeFile(
      workerFile,
      `
      const path=require('node:path'),backend=process.argv[2];
      const runtimePath=require.resolve('@prisma/client/runtime/library.js',{paths:[backend]}),runtime=require(runtimePath);
      require.cache[runtimePath].exports=new Proxy(runtime,{get(target,key){if(key==='warnEnvConflicts')return()=>{};if(key==='getPrismaClient')return config=>target.getPrismaClient({...config,relativeEnvPaths:{}});return Reflect.get(target,key);}});
      const {PrismaClient}=require(require.resolve('@prisma/client',{paths:[backend]}));
      const url=process.argv[3];if(new URL(url).hostname!=='127.0.0.1')throw Error('loopback required');
      const db=new PrismaClient({datasources:{db:{url}}});
      const {VisitorHistoryService}=require(path.join(backend,'dist/analytics/visitor-history.service'));
      const req=JSON.parse(process.argv[4]),now=new Date(process.argv[5]);
      Promise.all(Array.from({length:15},()=>new VisitorHistoryService(db).record(req,'/',undefined,now))).catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>db.$disconnect());
    `,
    );
    const processBrowser = await browser(at(20));
    const execFileAsync = require('node:util').promisify(
      require('node:child_process').execFile,
    );
    await Promise.all(
      Array.from({ length: 3 }, () =>
        execFileAsync(
          process.execPath,
          [
            workerFile,
            backend,
            url,
            JSON.stringify(processBrowser),
            at(20).toISOString(),
          ],
          { windowsHide: true },
        ),
      ),
    );
    await counts(at(20), 0, 1);
    await service.bridge(processBrowser, users.USER, at(20));
    await counts(at(20), 1, 0);
    pass(
      'three independent backend processes: 45 requests, one fact, atomic conversion',
    );
    app
      .getHttpAdapter()
      .getInstance()
      .get('/__visitorreview/:role', (req, res) => {
        const t = tokens[req.params.role];
        if (!t) return res.sendStatus(404);
        res.cookie('jwt', t.accessToken, { httpOnly: true, sameSite: 'lax' });
        res.cookie('refresh_token', t.refreshToken, {
          httpOnly: true,
          sameSite: 'lax',
        });
        res.redirect('/admin.html#section-dashboard');
      });
    await app.listen(43123, '127.0.0.1');
    const csrf = 'isolated-mailbox-csrf-000000000000';
    const http = async (url, cookie = '', body) =>
      fetch('http://127.0.0.1:43123' + url, {
        method: body ? 'POST' : 'GET',
        headers: {
          cookie: cookie + '; cronox_csrf_token=' + csrf,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
          referer: 'http://127.0.0.1:43123/',
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
      });
    assert.equal(
      (await http('/api/admin/visitors?from=2026-09-01&to=2026-09-01')).status,
      401,
    );
    assert.equal(
      (
        await http(
          '/api/admin/visitors?from=2026-09-01&to=2026-09-01',
          'jwt=' + tokens.USER.accessToken,
        )
      ).status,
      403,
    );
    pass('real administrative guards reject anonymous/customer');
    for (const body of [
      { path: '/', expectedCategory: 'anonymous', userId: users.USER.id },
      { path: '/', expectedCategory: 'anonymous', role: 'ADMIN' },
      { path: '/', expectedCategory: 'anonymous', browserId: randomUUID() },
    ])
      assert.equal((await http('/api/analytics/visits', '', body)).status, 400);
    pass('identity/role/legacy UUID rejected before whitelist stripping');
    assert.equal(
      (await http('/api/analytics/visits/session', 'jwt=invalid')).status,
      401,
    );
    assert.equal(
      (await http('/api/analytics/visits/session', 'refresh_token=unresolved'))
        .status,
      401,
    );
    pass('invalid and unresolved authentication never becomes guest');
    const { UsersService } = require(
      path.join(backend, 'dist/users/users.service'),
    );
    const lookup = app.get(UsersService),
      originalLookup = lookup.findById;
    const beforeFailure = await db.dailyVisitor.count();
    try {
      lookup.findById = async () => {
        throw new (require('@nestjs/common').ServiceUnavailableException)(
          'Synthetic lookup outage',
        );
      };
      assert.equal(
        (
          await http(
            '/api/analytics/visits/session',
            'jwt=' + tokens.USER.accessToken,
          )
        ).status,
        503,
      );
      assert.equal(await db.dailyVisitor.count(), beforeFailure);
    } finally {
      lookup.findById = originalLookup;
    }
    pass(
      'temporary authentication outage returns 503 without anonymous fallback',
    );
    const revoke = await http(
      '/api/analytics/visits/consent-revoked',
      'jwt=invalid; cronox_daily_visitor=synthetic',
      {},
    );
    assert.equal(revoke.status, 204);
    assert.match(
      revoke.headers.get('set-cookie'),
      /cronox_daily_visitor=;.*Path=\/api/,
    );
    const keep = await http(
      '/api/analytics/visits/consent-revoked',
      'cronox_cookie_consent=' + encodeURIComponent(consent),
      {},
    );
    assert.equal(keep.status, 400);
    pass(
      'consent cleanup clears proof even with invalid authentication and rejects active consent',
    );
    const today = new Date(),
      nowDay = today.toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
    const client = await browser(today);
    await record(client, today);
    const browserCookie = Object.entries(client.cookies)
      .map(([k, v]) => k + '=' + encodeURIComponent(v))
      .join('; ');
    const login = await http('/api/auth/login', browserCookie, {
      email: users.USER.email,
      password: 'Isolated-visitors-123!',
    });
    assert.equal(login.status, 200);
    let detail = await service.detail(nowDay, 'all', '', 1);
    assert.deepEqual(detail.totals, { authenticated: 1, anonymous: 0 });
    pass('actual login controller links pre-existing anonymous visit');
    const result = await http(
      '/api/admin/visitors?from=' + nowDay + '&to=' + nowDay,
      'jwt=' + tokens.SUPERADMIN.accessToken,
    );
    assert.equal(result.status, 200);
    assert.equal((await result.json()).buckets[0].authenticated, 1);
    pass('actual admin HTTP report shares effective SQL definition');
    const filtered = await service.detail(
      nowDay,
      'authenticated',
      'Synthetic USER',
      1,
    );
    assert.equal(filtered.pagination.total, 1);
    assert.equal(
      (await service.detail(nowDay, 'anonymous', '', 1)).pagination.total,
      0,
    );
    pass('category/search pagination and chart agree');
    console.log('All ' + passes.length + ' isolated visitor checks passed.');
    if (process.argv.includes('--serve')) {
      console.log(
        'Review URL: http://127.0.0.1:43123/__visitorreview/SUPERADMIN',
      );
      await new Promise(() => {});
    }
  } finally {
    await stop();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
