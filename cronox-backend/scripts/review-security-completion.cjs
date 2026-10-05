// Real PostgreSQL, HTTP guards and first-party mail templates. SMTP is captured in memory.
// Only review-security.cjs's newly created loopback database may invoke this module.
'use strict';
const assert = require('node:assert/strict'), path = require('node:path');
module.exports = async ({ db, dir }) => {
  const beforeCwd = process.cwd(); process.chdir(dir);
  process.env.CRONOX_ROUTE_SMOKE_MODE = 'true';
  const { Test } = require('@nestjs/testing'), { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('../dist/app.module');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { MailTransportFactory } = require('../dist/email/mail-transport.factory');
  const messages = []; let fail = false, uncertain = false;
  const transport = { sendMail: async (sender, options, purpose) => {
    if (fail) { fail = false; throw new Error('synthetic SMTP unavailable'); }
    messages.push({ sender, ...options, purpose });
    if (uncertain) { uncertain = false; throw Object.assign(new Error('synthetic delivery unknown'), { deliveryUnknown: true }); }
    return { messageId: 'captured-only', accepted: [options.to] };
  } };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(db)
    .overrideProvider(MailTransportFactory).useValue(transport).compile();
  const app = module.createNestApplication({ logger: ['error'] });
  let visualTokens, visualUser, base, finishVisual;
  app.getHttpAdapter().get('/__finish-review', (_req, res) => { res.sendStatus(200); finishVisual?.(); });
  // These fixture endpoints are registered only here, never in the production app.
  app.getHttpAdapter().get('/__completion', (_req, res) => {
    res.cookie('jwt', visualTokens.accessToken, { httpOnly: true, sameSite: 'lax' });
    res.cookie('refresh_token', visualTokens.refreshToken, { httpOnly: true, sameSite: 'lax' });
    res.cookie('cronox_csrf_token', 'completion-csrf', { sameSite: 'lax' }); res.redirect('/profile.html');
  });
  app.getHttpAdapter().get('/__captured-link', (_req, res) => {
    const message = [...messages].reverse().find(m => m.to === visualUser.email || m.to === 'visual-new@example.test');
    const match = message?.html.replace(/&#x3D;/g, '=').match(/href='([^']*#action=[^']*)'/);
    res.set('Cache-Control', 'no-store').json({ link: match?.[1]?.replace(/&amp;/g, '&').replace(/&#x3D;/g, '='), count: messages.length });
  });
  const express = require('express');
  app.setGlobalPrefix('api'); app.use(require('cookie-parser')());
  app.use(express.static(path.resolve(__dirname, '../../cronox-front/public')));
  app.use(express.static(path.resolve(__dirname, '../../cronox-front')));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  try {
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    process.env.FRONTEND_URL = base; process.env.CORS_ORIGINS = base;
    const { AuthSessionsService } = require('../dist/auth/auth-sessions.service');
    const sessions = app.get(AuthSessionsService);
    const cookieFor = async user => { const tokens = await sessions.create(user); return 'jwt=' + tokens.accessToken + '; refresh_token=' + tokens.refreshToken; };
    const request = async (route, { cookie = '', body, method = body === undefined ? 'GET' : 'POST' } = {}) => {
      const response = await fetch(base + '/api' + route, { method, headers: { origin: base, 'content-type': 'application/json',
        cookie: 'cronox_csrf_token=completion-csrf; ' + cookie, 'x-csrf-token': 'completion-csrf' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, data: await response.json().catch(() => null) };
    };
    const capability = (message, cancel = false) => {
      const match = message.html.replace(/&#x3D;/g, '=').match(cancel ? /href='([^']*#action=cancel[^']*)'/ : /href='([^']*#action=(?:authorize|verify)[^']*)'/);
      assert(match); const href = match[1].replace(/&amp;/g, '&').replace(/&#x3D;/g, '=');
      return Object.fromEntries(new URLSearchParams(new URL(href).hash.slice(1)));
    };
    const confirm = body => request('/email-change/confirm', { body });
    const create = (name, password = null, role = 'USER') => db.user.create({ data: { email: name + '@example.test', password, role, accountState: 'ACTIVE' } });
    let checks = 0;
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(db.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE ' + role);
        await tx.emailChangeRequest.findMany();
      }), /permission denied/);
      checks++;
    }
    for (const [name, password, role] of [['password', 'synthetic-hash', 'USER'], ['passwordless', null, 'FRIEND'], ['superadmin', null, 'SUPERADMIN']]) {
      app.get(require('@nestjs/throttler').getStorageToken()).onApplicationShutdown(); // Separate synthetic clients; retain real limits in each flow.
      const user = await create(name, password, role), cookie = await cookieFor(user), target = name + '-new@example.test';
      await db.passwordResetToken.create({ data: { userId: user.id, token: 'old-hash-' + name, expiresAt: new Date(Date.now() + 60000) } });
      await db.preRegistration.create({ data: { userId: user.id, launchTokenHash: 'old-launch-' + name, launchTokenExpiresAt: new Date(Date.now() + 60000) } });
      await db.newsletterMailJob.create({ data: { userId: user.id, email: user.email, kind: 'ACCESS', tokenHash: 'old-access-' + name } });
      const started = await request('/me/email-change', { cookie, body: { newEmail: target } }); assert.equal(started.status, 201);
      const first = messages.at(-1); assert.equal(first.to, user.email); assert.equal(first.sender, 'NOREPLY');
      assert(first.html.includes(target)); assert(first.html.includes("href='mailto:support@cronox.es'"));
      assert(first.html.includes('cancela la solicitud')); assert.equal(first.purpose, 'EMAIL_CHANGE_AUTHORIZE');
      const initial = await db.emailChangeRequest.findUnique({ where: { userId: user.id } });
      const auth = capability(first); assert(!JSON.stringify(initial).includes(auth.token));
      assert.equal((await request('/me/email-change', { cookie, body: { newEmail: target, password: 'irrelevant' } })).status, 400);
      assert.equal((await confirm({ ...auth, action: 'verify' })).status, 400);
      assert.equal((await request('/me', { cookie, method: 'PUT', body: { email: target } })).status, 400);
      assert.equal((await request('/me/email-change', { cookie, body: { newEmail: target } })).status, 201);
      assert.equal(messages.at(-1), first, 'same request is deduplicated');
      assert.equal((await request('/me/email-change/resend', { cookie, body: {} })).status, 429);
      const scanner = await fetch(base + '/email-change.html#action=authorize&token=' + auth.token); assert.equal(scanner.status, 200);
      assert.equal((await request('/email-change/inspect', { body: auth })).status, 201);
      assert.equal((await db.user.findUnique({ where: { id: user.id } })).email, user.email);
      assert.equal(messages.at(-1), first, 'GET and inspection never advance or send');
      const authResults = await Promise.all([confirm(auth), confirm(auth)]); assert.deepEqual(authResults.map(r => r.status).sort(), [201, 400]);
      const second = messages.at(-1); assert.equal(second.to, target); assert.equal(second.sender, 'NOREPLY');
      assert.equal(second.purpose, 'EMAIL_CHANGE_VERIFY');
      assert.equal((await request('/me', { cookie })).data.email, user.email);
      const final = capability(second);
      const finalResults = await Promise.all([confirm(final), confirm(final)]); assert.deepEqual(finalResults.map(r => r.status).sort(), [201, 400]);
      const updated = await db.user.findUnique({ where: { id: user.id } });
      assert.equal(updated.email, target); assert.equal(updated.password, password); assert.equal(updated.role, role);
      assert.equal(updated.accountState, user.accountState); assert.equal(updated.newsletterSubscribed, user.newsletterSubscribed);
      assert.equal(updated.sessionVersion, user.sessionVersion + 1); assert.equal((await request('/me', { cookie })).status, 401);
      assert((await db.passwordResetToken.findFirst({ where: { userId: user.id } })).usedAt);
      assert((await db.preRegistration.findUnique({ where: { userId: user.id } })).launchTokenUsedAt);
      assert((await db.newsletterMailJob.findFirst({ where: { userId: user.id, kind: 'ACCESS' } })).tokenUsedAt);
      assert.equal(await db.authSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
      assert.equal((await confirm(final)).status, 400); assert.equal((await confirm(auth)).status, 400);
      checks += 26;
    }
    // Remaining lifecycle cases exercise the same service against real transactions.
    const { EmailChangeService } = require('../dist/me/email-change.service');
    const changes = app.get(EmailChangeService);
    const user = await create('lifecycle'), target = 'lifecycle-new@example.test';
    await changes.start(user.id, target); const first = capability(messages.at(-1)), cancel = capability(messages.at(-1), true);
    assert.equal((await changes.confirm(cancel.token, cancel.action)).stage, 'CANCELLED');
    await assert.rejects(changes.confirm(first.token, first.action));
    const age = () => db.emailChangeRequest.update({ where: { userId: user.id }, data: { lastSentAt: new Date(Date.now() - 61000) } });
    await age(); await changes.start(user.id, target); const replaced = capability(messages.at(-1));
    await age(); await changes.start(user.id, 'replacement@example.test');
    await assert.rejects(changes.confirm(replaced.token, replaced.action));
    const expired = capability(messages.at(-1)); await db.emailChangeRequest.update({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1) } });
    await assert.rejects(changes.confirm(expired.token, expired.action));
    await age(); fail = true; await assert.rejects(changes.start(user.id, 'retry@example.test'));
    assert.equal((await changes.status(user.id)).delivery, 'FAILED'); await age(); await changes.resend(user.id);
    const retry = capability(messages.at(-1)); uncertain = true; await assert.rejects(changes.confirm(retry.token, retry.action));
    assert.equal((await changes.status(user.id)).stage, 'PENDING_NEW'); assert.equal((await changes.status(user.id)).delivery, 'UNKNOWN');
    await assert.rejects(changes.confirm(retry.token, retry.action));
    const delivered = capability(messages.at(-1)); await age(); await changes.resend(user.id);
    assert.deepEqual(capability(messages.at(-1)), delivered, 'retry preserves the same single-use capability');
    await create('retry'); await assert.rejects(changes.confirm(delivered.token, delivered.action), /ya está en uso/);
    assert.equal((await db.user.findUnique({ where: { id: user.id } })).email, user.email);
    for (let n = 0; n < 3; n++) { await age(); await changes.resend(user.id); }
    await age(); await assert.rejects(changes.resend(user.id), /Máximo cinco/);
    assert.equal((await changes.cancel(user.id)).stage, 'CANCELLED'); checks += 17;
    await age(); await changes.start(user.id, 'fifth-request@example.test');
    await age(); await assert.rejects(changes.start(user.id, 'sixth-request@example.test'), /Demasiadas solicitudes/);
    checks += 2;
    const { EmailService } = require('../dist/email/email.service');
    await app.get(EmailService).sendEmailChange('escape-only@example.test', { authorize: true,
      newEmail: '<img src=x onerror=alert(1)>', actionUrl: base + '/email-change.html', cancelUrl: base + '/email-change.html' });
    assert(!messages.at(-1).html.includes('<img')); assert(messages.at(-1).html.includes('&lt;img'));
    checks += 2;

    // All seven export modules still use their real SQL and workbook generation.
    const { AdminExportsService } = require('../dist/admin/exports/admin-exports.service');
    const exports = app.get(AdminExportsService);
    const actor = await create('export-superadmin', null, 'SUPERADMIN');
    for (const module of ['usuarios', 'pedidos', 'productos', 'inventario', 'circulos', 'codigos', 'actividad']) {
      const result = await exports.export(module, { scope: 'all' }, actor.id, {});
      assert(Buffer.isBuffer(result.buffer) || Buffer.isBuffer(result.body));
    }
    const { withExportSqlDeadline } = require('../dist/admin/exports/export-sql-deadline');
    // Block the real product-export SELECT on an isolated table lock. The normal
    // concurrent user export touches other tables; no middleware fakes a response.
    let locked, releaseLock;
    const lockReady = new Promise(resolve => { locked = resolve; });
    const lockRelease = new Promise(resolve => { releaseLock = resolve; });
    const blocker = db.$transaction(async tx => {
      await tx.$executeRawUnsafe('LOCK TABLE "Product" IN ACCESS EXCLUSIVE MODE');
      locked(); await lockRelease;
    }, { timeout: 36000 });
    await lockReady;
    const started = Date.now();
    const timed = exports.export('productos', { scope: 'all' }, actor.id, {}).then(
      () => { throw Error('expected SQL timeout'); }, error => { assert.equal(error.getStatus(), 408); return Date.now() - started; });
    await new Promise(r => setTimeout(r, 100));
    // Concurrent independent export and ordinary query must remain operational.
    const other = await exports.export('usuarios', { scope: 'all' }, actor.id, {}); assert(other.filename);
    assert.equal((await db.$queryRawUnsafe('SELECT 42 AS ok'))[0].ok, 42);
    const elapsedMs = await timed;
    const active = await db.$queryRawUnsafe("SELECT count(*)::int AS count FROM pg_stat_activity WHERE state='active' AND wait_event_type='Lock' AND query LIKE '%Product%' AND pid <> pg_backend_pid()");
    assert.equal(active[0].count, 0);
    releaseLock(); await blocker;
    const setting = await db.$queryRawUnsafe('SHOW statement_timeout'); assert.equal(setting[0].statement_timeout, '0');
    assert.equal((await request('/products')).status, 200);
    // A second export concurrently cancels only its own transaction at a shorter fixture deadline.
    const concurrent = await Promise.allSettled([
      withExportSqlDeadline(db, tx => tx.$queryRawUnsafe('SELECT pg_sleep(0.5)'), 100),
      withExportSqlDeadline(db, tx => tx.$queryRawUnsafe('SELECT 7 AS ok'), 2000),
    ]);
    assert.equal(concurrent[0].status, 'rejected'); assert.equal(concurrent[0].reason.getStatus(), 408);
    assert.equal(concurrent[1].status, 'fulfilled'); assert.equal(concurrent[1].value[0].ok, 7);
    console.log(JSON.stringify({ emailLifecycleChecks: checks, exportModules: 7, exportTimeout: { elapsedMs, activeAfter: active[0].count, statementTimeoutOutsideExport: setting[0].statement_timeout }, concurrentExports: 'timeout isolated; second export and public products succeed', mail: 'NOREPLY captured in memory only' }, null, 2));
    if (process.argv.includes('--serve')) {
      visualUser = await create('visual-profile'); visualTokens = await sessions.create(visualUser);
      console.log('COMPLETION_BROWSER_URL=' + base);
      await new Promise(resolve => { finishVisual = resolve; process.once('SIGINT', resolve); process.once('SIGTERM', resolve); });
    }
  } finally { await app.close(); process.chdir(beforeCwd); }
};
