'use strict';
// Invoked by review-security.cjs --resilience ONLY in its disposable PostgreSQL.
// Query events count SQL statements, not ORM calls. Never persist SQL/parameters/tokens.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const clients = [], queries = [];
exports.instrumentClient = Client => class extends Client {
  constructor(options) {
    super({ ...options, log: [{ level: 'query', emit: 'event' }] });
    this.$on('query', event => queries.push({
      identity: /"(?:AuthSession|User)"/.test(event.query),
      catalog: /"(?:Product|ProductVariant|ProductImage|Category|ProductCategory)"/.test(event.query),
      gate: /"KeyScreenSettings"/.test(event.query),
      durationMs: event.duration,
    }));
    clients.push(this);
  }
};
exports.review = async ({ db, dir, stop, start }) => {
  const oldCwd = process.cwd(); process.chdir(dir);
  const before = process.argv.includes('--before');
  const { Test } = require('@nestjs/testing');
  const { ValidationPipe } = require('@nestjs/common');
  const { JwtService } = require('@nestjs/jwt');
  const { AppModule } = require('../dist/app.module');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { AuthService } = require('../dist/auth/auth.service');
  const { AuthSessionsService } = require('../dist/auth/auth-sessions.service');
  const { KeyScreenService } = require('../dist/key-screen/key-screen.service');
  const { createPublicHtmlGateMiddleware } = require('../dist/common/routing/public-html-gate.middleware');
  const { createSeoCatalog, createSeoDiscovery, createSeoPages, seoRequestSignals } = require('../dist/common/routing/public-seo');
  const { legacyRedirectTarget } = require('../dist/common/routing/public-pages');
  const frontendRoot = path.resolve(__dirname, '../../cronox-front');
  // No Prisma override: count the actual dependency-injection instances/pools.
  const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = module.createNestApplication({ logger: false });
  let down = false, base;
  const rows = [];
  try {
    const express = require('express');
    app.setGlobalPrefix('api');
    app.use(require('cookie-parser')());
    app.use((req, res, next) => { req.csrfToken = 'resilience-local-csrf'; next(); });
    const sessions = app.get(AuthSessionsService), auth = app.get(AuthService), gate = app.get(KeyScreenService);
    const prisma = app.get(PrismaService);
    const catalog = createSeoCatalog(prisma);
    const user = await db.user.create({ data: { email: 'resilience-user@example.test' } });
    const admin = await db.user.create({ data: { email: 'resilience-admin@example.test', role: 'ADMIN' } });
    const tokens = await sessions.create(user), adminTokens = await sessions.create(admin);
    const cookie = pair => `jwt=${pair.accessToken}; refresh_token=${pair.refreshToken}`;
    const userCookie = cookie(tokens), adminCookie = cookie(adminTokens);
    const product = await db.product.create({ data: { name: 'Resilience fixture', slug: 'resilience-fixture', price: 2500, variants: { create: { sku: 'RESILIENCE-M', size: 'M', stockQty: 10 } } }, include: { variants: true } });
    const http = app.getHttpAdapter().getInstance();
    http.get('/__resilience/login', async (req, res) => {
      const pair = await sessions.create(req.query.admin ? admin : user);
      res.cookie('jwt', pair.accessToken, { httpOnly: true, sameSite: 'lax' });
      res.cookie('refresh_token', pair.refreshToken, { httpOnly: true, sameSite: 'lax' });
      res.cookie('cronox_csrf_token', 'resilience-local-csrf', { sameSite: 'lax' });
      res.redirect('/cuenta');
    });
    http.post('/__resilience/down', (_req, res) => { if (!down) { stop(); down = true; } res.json({ ok: true }); });
    http.post('/__resilience/up', (_req, res) => { if (down) { start(); down = false; } res.json({ ok: true }); });
    http.post('/__resilience/expire', async (req, res) => {
      const session = await sessions.verify(req.cookies.jwt, 'access');
      const expired = new JwtService().sign({ sub: session.userId, sv: session.sessionVersion, sid: session.id, type: 'access' },
        { secret: process.env.JWT_ACCESS_SECRET, algorithm: 'HS256', expiresIn: -1 });
      res.cookie('jwt', expired, { httpOnly: true, sameSite: 'lax' });
      res.sendStatus(204);
    });
    http.get('/__resilience/metrics', (_req, res) => res.json({ sql: queries.length, identitySql: queries.filter(q => q.identity).length }));
    app.use((_req, res, next) => {
      const send = res.send.bind(res);
      res.send = body => send(typeof body === 'string' ? body.replace('<head>', `<head><meta name="cronox:api-base" content="${base}">`) : body);
      next();
    });
    app.use(seoRequestSignals);
    app.use(createSeoDiscovery(catalog, () => gate.shouldGatePublicHtml()));
    app.use(createPublicHtmlGateMiddleware({ authService: auth, keyScreen: gate, frontendRoot }));
    app.use((req, res, next) => {
      const target = ['GET', 'HEAD'].includes(req.method) && legacyRedirectTarget(req.path, req.originalUrl);
      return target ? res.redirect(308, target) : next();
    });
    app.use(createSeoPages(frontendRoot, catalog));
    app.use(express.static(path.join(frontendRoot, 'public')));
    app.use(express.static(frontendRoot));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    process.env.CORS_ORIGINS = base;
    const request = async (route, opts = {}) => {
      const t = performance.now();
      const res = await fetch(base + route, { method: opts.method || 'GET', redirect: 'manual',
        headers: { accept: 'text/html', origin: base, 'content-type': 'application/json',
          cookie: `cronox_csrf_token=resilience-local-csrf; ${opts.cookie || ''}`, 'x-csrf-token': 'resilience-local-csrf', ...opts.headers },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: AbortSignal.timeout(15000) });
      const body = await res.text();
      return { status: res.status, ms: Math.round((performance.now() - t) * 10) / 10,
        clearsSession: res.headers.getSetCookie().some(c => /^(jwt|refresh_token)=;/.test(c)), body };
    };
    const measure = async (name, tasks, concurrency = 1) => {
      const from = queries.length, t = performance.now();
      const results = [];
      for (let i = 0; i < tasks.length; i += concurrency) results.push(...await Promise.all(tasks.slice(i, i + concurrency).map(fn => fn())));
      const sql = queries.slice(from), times = results.map(r => r.ms).sort((a,b) => a-b);
      const row = { name, requests: results.length, concurrency, statuses: results.map(r => r.status),
        sql: sql.length, identitySql: sql.filter(q => q.identity).length, catalogSql: sql.filter(q => q.catalog).length,
        gateSql: sql.filter(q => q.gate).length, clearsSession: results.some(r => r.clearsSession),
        elapsedMs: Math.round(performance.now() - t), p50Ms: times[Math.floor(times.length / 2)], maxMs: times.at(-1) };
      rows.push(row); console.log(JSON.stringify(row)); return results;
    };
    const sample = (name, route, opts, n = 4, concurrency = 1) => measure(name, Array.from({ length: n }, () => () => request(route, opts)), concurrency);
    await request('/tienda'); // gate/template/database warm-up, excluded from samples
    console.log(JSON.stringify({ applicationPrismaClients: clients.length - 1, fixturePoolLimit: 2, poolTimeoutSeconds: 1 }));
    const jwt = new JwtService();
    const invalid = 'jwt=invalid-signature';
    const expired = 'jwt=' + jwt.sign({ sub: user.id, sv: 0, sid: 'invalid', type: 'access' }, { secret: process.env.JWT_ACCESS_SECRET, algorithm: 'HS256', expiresIn: -1 });
    for (const [kind, credentials] of [['anonymous', ''], ['user', userCookie], ['invalid', invalid], ['expired', expired]]) {
      for (const route of ['/tienda', '/api/products?limit=48', '/api/me', '/missing-page', '/api/missing']) {
        const result = await sample(kind + ' ' + route, route, { cookie: credentials });
        if (kind !== 'user') assert.equal(rows.at(-1).identitySql, 0, 'No identity SQL for absent/invalid/expired tokens');
        if (route === '/api/me') assert(result.every(r => r.status === (kind === 'user' ? 200 : 401)));
      }
    }
    for (const type of ['access', 'refresh']) {
      const claims = jwt.decode(type === 'access' ? tokens.accessToken : tokens.refreshToken);
      const route = type === 'access' ? '/api/me' : '/api/auth/refresh';
      for (const [reason, secret, algorithm] of [
        ['wrong signature', 'isolated-wrong-signing-key-for-regression-only', 'HS256'],
        ['disallowed algorithm', process.env[type === 'access' ? 'JWT_ACCESS_SECRET' : 'JWT_REFRESH_SECRET'], 'HS384'],
      ]) {
        const token = jwt.sign(claims, { secret, algorithm });
        const [rejected] = await sample(type + ' ' + reason, route, {
          method: type === 'access' ? 'GET' : 'POST',
          cookie: (type === 'access' ? 'jwt=' : 'refresh_token=') + token,
        }, 1);
        assert.equal(rejected.status, 401);
        assert.equal(rows.at(-1).identitySql, 0, 'Reject cryptographically before identity storage');
      }
    }
    await sample('user refresh', '/api/auth/refresh', { method: 'POST', cookie: userCookie }, 2);
    await sample('admin HTML', '/admin.html', { cookie: adminCookie }, 2);
    const withSlowTable = async (table, operation) => {
      let ready, release;
      const locked = new Promise(r => { ready = r; });
      const unlock = new Promise(r => { release = r; });
      const lock = db.$transaction(async tx => {
        assert(['KeyScreenSettings', 'Product'].includes(table));
        await tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);
        ready(); await unlock;
      });
      await locked;
      const timer = setTimeout(release, 250);
      try { await operation(); } finally { clearTimeout(timer); release(); await lock; }
    };
    gate.invalidateGateCache();
    await withSlowTable('KeyScreenSettings', () => sample('concurrent cold gate', '/sobre-cronox', {}, 12, 12));
    await withSlowTable('Product', () => sample('concurrent SEO storefront', '/tienda', {}, 12, 12));
    await sample('SEO product', '/producto/resilience-fixture', {}, 4);
    await sample('API same product', '/api/products/resilience-fixture', {}, 4);
    // Real pool exhaustion: occupy this app pool's two connections for 1.6 seconds.
    const holds = clients.slice(1).flatMap(client => [client.$queryRaw`SELECT 1 FROM pg_sleep(1.6)`, client.$queryRaw`SELECT 1 FROM pg_sleep(1.6)`]);
    const holding = Promise.all(holds);
    await new Promise(r => setTimeout(r, 150));
    const saturated = await sample('pool exhausted protected request', '/api/me', { cookie: userCookie }, 1);
    if (!before) { assert.equal(saturated[0].status, 503); assert.equal(saturated[0].clearsSession, false); }
    await holding;
    const loginStarted = Date.now();
    const login = await sample('login attempt limiter', '/api/auth/login', { method: 'POST', body: {} }, 11);
    assert.equal(login.at(-1).status, 429);
    assert.equal((await request('/api/auth/login', { method: 'POST', body: {}, headers: { 'x-forwarded-for': '203.0.113.99' } })).status, 429, 'Untrusted XFF cannot escape limiter');
    assert.equal((await request('/admin-login.html')).status, 200, 'Loading login HTML is independent of attempts');
    assert.equal((await request('/api/products')).status, 200, 'Shared-IP buyer still browses');
    assert.equal((await request('/api/me', { cookie: userCookie })).status, 200, 'Shared-IP authenticated buyer still operates');
    const mixed = await measure('limited attempts with legitimate shared-IP traffic', [
      ...Array.from({ length: 12 }, () => () => request('/api/auth/login', { method: 'POST', body: {} })),
      () => request('/api/products'), () => request('/api/me', { cookie: userCookie }),
      () => request('/api/cart/items', { method: 'POST', cookie: userCookie, body: { variantId: product.variants[0].id, qty: 1 } }),
    ], 8);
    assert(mixed.slice(0, 12).every(r => r.status === 429));
    assert.deepEqual(mixed.slice(12).map(r => r.status), [200, 200, 201]);
    stop(); down = true;
    for (const [name, route, opts] of [
      ['down health', '/api/health', {}], ['down readiness', '/api/ready', {}],
      ['down anonymous identity', '/api/me', {}], ['down user identity', '/api/me', { cookie: userCookie }],
      ['down refresh', '/api/auth/refresh', { method: 'POST', cookie: userCookie }],
      ['down admin HTML', '/admin.html', { cookie: adminCookie }],
      ['down products', '/api/products', {}], ['down categories', '/api/categories', {}], ['down SEO', '/tienda', {}],
    ]) {
      const [result] = await sample(name, route, opts, 1);
      if (!before && !['down health', 'down anonymous identity'].includes(name)) {
        assert.equal(result.status, 503, name); assert.equal(result.clearsSession, false, name);
      }
    }
    start(); down = false;
    assert.equal((await request('/api/me', { cookie: userCookie })).status, 200, 'same cookies work after database recovery');
    if (!before) assert.equal((await request('/api/ready')).status, 200, 'readiness recovers without restart');
    // Reopen only the fixture-control pool, unused during the outage. The
    // application recovery above used its original pool without restart.
    await db.$disconnect(); await db.$connect();
    for (const reason of ['revoked', 'disabled', 'version']) {
      const actor = await db.user.create({ data: { email: `resilience-${reason}@example.test` } });
      const pair = await sessions.create(actor);
      if (reason === 'revoked') await db.authSession.updateMany({ where: { userId: actor.id }, data: { revokedAt: new Date() } });
      if (reason === 'disabled') await db.user.update({ where: { id: actor.id }, data: { accountState: 'PENDING_PASSWORD' } });
      if (reason === 'version') await db.user.update({ where: { id: actor.id }, data: { sessionVersion: { increment: 1 } } });
      const [denied] = await sample('valid signature but ' + reason, '/api/me', { cookie: cookie(pair) }, 1);
      assert.equal(denied.status, 401);
      assert.equal((await request('/api/auth/refresh', { method: 'POST', cookie: cookie(pair) })).status, 401);
    }
    if (process.argv.includes('--pending-review')) {
      await require('./review-resilience-extra.cjs').review({ db, prisma, app, sample });
    }
    if (!process.argv.includes('--quick')) {
      const remaining = Math.max(0, 61000 - (Date.now() - loginStarted));
      console.log('Waiting for the existing 60-second login window to expire (' + remaining + 'ms)');
      await new Promise(r => setTimeout(r, remaining));
      assert.equal((await request('/api/auth/login', { method: 'POST', body: {} })).status, 400, 'limiter recovers after its existing window');
    }
    const artifactDir = path.resolve(__dirname, '../../output/playwright/resilience-2026-10-05');
    await fs.mkdir(artifactDir, { recursive: true });
    await fs.writeFile(path.join(artifactDir, before ? 'before.json' : 'after.json'), JSON.stringify({ applicationPrismaClients: clients.length - 1, rows }, null, 2));
    console.log('PASS bounded local SQL/identity/limiter/outage measurements; external requests: 0');
    if (process.argv.includes('--serve')) {
      console.log('RESILIENCE_REVIEW_READY ' + base);
      await new Promise(resolve => {
        const finish = () => { process.stdin.removeListener('data', onData); process.stdin.pause(); resolve(); };
        const onData = data => { if (String(data).trim() === 'stop') finish(); };
        process.stdin.on('data', onData);
      });
    }
  } finally { if (down) start(); await app.close(); process.chdir(oldCwd); }
};
