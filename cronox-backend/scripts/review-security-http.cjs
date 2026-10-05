// Real Nest controllers, JWT sessions, CSRF, validation and PostgreSQL; email is captured in memory.
'use strict';
const assert = require('node:assert/strict'), { createHash, randomBytes } = require('node:crypto');
module.exports = async ({ db, dir, diagnose }) => {
  const oldCwd = process.cwd(); process.chdir(dir);
  process.env.CRONOX_ROUTE_SMOKE_MODE = 'true';
  const { Test } = require('@nestjs/testing'), { ValidationPipe } = require('@nestjs/common');
  const { AppModule } = require('../dist/app.module');
  const { PrismaService } = require('../dist/prisma/prisma.service');
  const { EmailService } = require('../dist/email/email.service');
  let resetLink, delivered;
  const changes = [];
  const resetDelivered = new Promise(resolve => { delivered = resolve; });
  const mail = { sendEmailChange: async (to, data) => { changes.push({ to, ...data }); }, isEnabled: () => true, sendPasswordReset: async (_email, link) => { resetLink = link; delivered(); } };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(db).overrideProvider(EmailService).useValue(mail).compile();
  const app = module.createNestApplication({ logger: ['error'] });
  try {
    let base, browserTokens;
    // Optional visual review serves the repository HTML with this isolated API.
    // The fixture login route exists only inside this disposable test harness.
    app.getHttpAdapter().get('/__securityreview', (_req, res) => {
      if (!browserTokens) return res.sendStatus(503);
      res.cookie('jwt', browserTokens.accessToken, { httpOnly: true, sameSite: 'lax' });
      res.cookie('refresh_token', browserTokens.refreshToken, { httpOnly: true, sameSite: 'lax' });
      res.cookie('cronox_csrf_token', 'synthetic-audit-csrf', { sameSite: 'lax' });
      res.redirect('/profile.html');
    });
    app.use(async (req, res, next) => {
      if (req.method !== 'GET' || !['/profile.html', '/cart.html', '/checkout.html', '/index.html'].includes(req.path)) return next();
      const fs = require('node:fs/promises'), path = require('node:path');
      const html = await fs.readFile(path.resolve(__dirname, '../../cronox-front', req.path.slice(1)), 'utf8');
      res.type('html').send(html.replace('<head>', `<head><meta name="cronox:api-base" content="${base}">`));
    });
    app.setGlobalPrefix('api'); app.use(require('cookie-parser')());
    const express = require('express');
    app.use(express.static(require('node:path').resolve(__dirname, '../../cronox-front/public')));
    app.use(express.static(require('node:path').resolve(__dirname, '../../cronox-front')));
    app.use(['/api/webhooks/stripe', '/api/payments/webhook'], express.raw({ type: 'application/json', limit: '100kb' }));
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    process.env.CORS_ORIGINS = base;
    const csrf = 'synthetic-audit-csrf', password = 'Audit-only-strong-password-47';
    const request = async (route, { method = 'GET', body, cookie = '', extra = {} } = {}) => {
      const response = await fetch(base + '/api' + route, { method, headers: { origin: base, 'content-type': 'application/json', cookie: `cronox_csrf_token=${csrf}; ${cookie}`, 'x-csrf-token': csrf, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text(); let value; try { value = JSON.parse(text); } catch { value = text; }
      return { status: response.status, value, cookie: response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
    };
    const register = { firstName: 'Audit', lastName: 'User', email: 'http-user@example.test', password };
    for (const route of ['/auth/register', '/auth/login', '/auth/forgot-password']) {
      const malformed = await request(route, { method: 'POST', body: route.endsWith('register') ? { ...register, email: {} } : { email: {} } });
      if (diagnose) console.log(JSON.stringify({ check: 'Non-string email', route, status: malformed.status, expected: 400 }));
      else assert.equal(malformed.status, 400);
    }
    assert.equal((await request('/auth/register', { method: 'POST', body: { ...register, role: 'SUPERADMIN' } })).status, 400);
    const created = await request('/auth/register', { method: 'POST', body: register }); assert.equal(created.status, 201);
    const cookie = created.cookie, user = await db.user.findUnique({ where: { email: register.email } });
    assert.equal(created.value.user.hasPassword, true);
    assert.equal((await request('/me', { cookie })).value.hasPassword, true);
    assert.equal((await request('/auth/me', { cookie })).value.hasPassword, true);
    assert.equal(user.role, 'USER'); assert.notEqual(user.password, password);
    assert(!JSON.stringify(created.value).includes(user.password));
    assert.equal((await request('/admin/categories', { cookie })).status, 403);
    assert.equal((await request('/admin/categories')).status, 401);
    assert.equal((await request('/me', { method: 'PUT', cookie, body: { role: 'SUPERADMIN' } })).status, 400);
    assert.equal((await request('/me', { method: 'PUT', cookie, body: { firstName: 'Changed' }, extra: { origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await request('/me', { method: 'PUT', cookie, body: { firstName: 'Changed' }, extra: { 'x-csrf-token': 'wrong' } })).status, 403);
    const other = await db.user.create({ data: { email: 'other-owner@example.test' } });
    const address = await db.address.create({ data: { userId: other.id, name: 'Other', line1: 'Test 1', city: 'Madrid', zip: '28001', country: 'ES' } });
    assert.equal((await request('/me/addresses/' + address.id, { method: 'DELETE', cookie })).status, 404);
    assert(await db.address.findUnique({ where: { id: address.id } }));
    const { AuthSessionsService } = require('../dist/auth/auth-sessions.service');
    const sessions = app.get(AuthSessionsService);
    const passwordlessSession = await sessions.create(other);
    const passwordlessCookie = 'jwt=' + passwordlessSession.accessToken;
    assert.equal((await request('/me', { cookie: passwordlessCookie })).value.hasPassword, false);
    assert.equal((await request('/auth/me', { cookie: passwordlessCookie })).value.hasPassword, false);
    for (const role of ['ADMIN', 'SUPERADMIN']) {
      const actor = await db.user.create({ data: { email: role.toLowerCase() + '-http@example.test', role } });
      const tokens = await sessions.create(actor), adminCookie = 'jwt=' + tokens.accessToken;
      const response = await request('/products', { method: 'POST', cookie: adminCookie, body: {} });
      // Existing generic-role policy intentionally grants both admin roles;
      // keep this decision explicit, separate from the strict exclusive guard.
      assert.equal(response.status, 400);
      if (role === 'ADMIN') console.log('POLICY REVIEW: generic @Roles(SUPERADMIN) also accepts ADMIN (legacy policy, not changed without product decision)');
      assert.equal((await request('/admin/audit-logs', { method: 'DELETE', cookie: adminCookie, body: {} })).status, role === 'ADMIN' ? 403 : 400);
      if (process.argv.includes('--pending-review')) {
        const samples = [
          ['read orders', '/admin/orders', 'GET', undefined, 200],
          ['read another user', '/admin/users/' + other.id, 'GET', undefined, 200],
          ['create admin product reaches validation', '/admin/products', 'POST', {}, 400],
          ['create promotion reaches validation', '/admin/promo-codes', 'POST', {}, 400],
          ['change role protected strictly', '/admin/users/' + other.id + '/role', 'PATCH', {}, role === 'ADMIN' ? 403 : 400],
          ['bulk protected strictly', '/admin/bulk/preview', 'POST', {}, role === 'ADMIN' ? 403 : 400],
        ];
        const results = [];
        for (const [name, route, method, body, expected] of samples) {
          const result = await request(route, { method, body, cookie: adminCookie });
          assert.equal(result.status, expected, role + ': ' + name);
          results.push({ name, status: result.status });
        }
        console.log(JSON.stringify({ policyReview: role, results }));
      }
    }
    const product = await db.product.findUnique({ where: { slug: 'audit-shirt' }, include: { variants: true } });
    for (const body of [{ variantId: product.variants[0].id, qty: -1 }, { variantId: product.variants[0].id, qty: 1, price: 1 }, { variantId: 2147483647, qty: 1 }]) {
      const response = await request('/cart/items', { method: 'POST', cookie, body }); assert([400, 404].includes(response.status));
    }
    await request('/auth/forgot-password', { method: 'POST', body: { email: register.email } });
    await resetDelivered;
    assert(resetLink, 'capture reset email only in memory'); const oldToken = new URL(resetLink).searchParams.get('token');
    const launchToken = randomBytes(32).toString('hex');
    await db.preRegistration.create({ data: { userId: user.id, launchTokenHash: createHash('sha256').update(launchToken).digest('hex'), launchTokenExpiresAt: new Date(Date.now() + 60000) } });
    assert.equal((await request('/me', { method: 'PUT', cookie, body: { email: 'http-changed@example.test' } })).status, 400);
    const changed = await request('/me/email-change', { method: 'POST', cookie, body: { newEmail: 'http-changed@example.test' } });
    assert.equal(changed.status, 201);
    const capability = message => Object.fromEntries(new URLSearchParams(new URL(message.actionUrl).hash.slice(1)));
    assert.equal(changes.at(-1).to, register.email);
    assert.equal((await request('/email-change/confirm', { method: 'POST', body: capability(changes.at(-1)) })).status, 201);
    assert.equal(changes.at(-1).to, 'http-changed@example.test');
    assert.equal((await request('/email-change/confirm', { method: 'POST', body: capability(changes.at(-1)) })).status, 201);
    assert.equal((await request('/me', { cookie })).status, 401, 'Completed email change revokes previous sessions');
    const oldReset = await request('/auth/reset-password', { method: 'POST', body: { token: oldToken, password: password + '-new' } });
    if (diagnose) console.log(JSON.stringify({ check: 'Reset link sent before email change', status: oldReset.status, expected: 400 }));
    else assert.equal(oldReset.status, 400, 'old mailbox must lose password recovery authority after email change');
    assert.equal((await request('/auth/launch-login', { method: 'POST', body: { token: launchToken } })).status, 401);
    const freshToken = randomBytes(32).toString('hex');
    await db.passwordResetToken.create({ data: { userId: user.id, token: createHash('sha256').update(freshToken).digest('hex'), expiresAt: new Date(Date.now() + 60000) } });
    const reset = { method: 'POST', body: { token: freshToken, password: password + '-changed' } };
    const resetResults = await Promise.all([request('/auth/reset-password', reset), request('/auth/reset-password', reset)]);
    assert.deepEqual(resetResults.map(r => r.status).sort(), [201, 400]);
    assert.equal((await request('/auth/me', { cookie })).status, 401, 'password reset invalidates old session');
    const loggedIn = await request('/auth/login', { method: 'POST', body: { email: 'http-changed@example.test', password: password + '-changed' } });
    assert.equal(loggedIn.status, 200);
    const refresh = await Promise.all([request('/auth/refresh', { method: 'POST', cookie: loggedIn.cookie }), request('/auth/refresh', { method: 'POST', cookie: loggedIn.cookie })]);
    assert(refresh.every(r => r.status === 200));
    assert.equal((await request('/auth/logout', { method: 'POST', cookie: refresh[0].cookie })).status, 204);
    assert.equal((await request('/auth/me', { cookie: refresh[0].cookie })).status, 401);
    // Actual Stripe SDK signature verification, entirely local synthetic events.
    const Stripe = require('stripe'), stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const event = { id: 'evt_isolated_signature', type: 'audit.unhandled', created: Math.floor(Date.now() / 1000), livemode: false, data: { object: {} } };
    const payload = JSON.stringify(event);
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
    const sendEvent = async (body, signatureValue) => fetch(base + '/api/webhooks/stripe', { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signatureValue }, body });
    assert.equal((await sendEvent(payload, 'invalid')).status, 400);
    assert.equal((await sendEvent(payload + ' ', signature)).status, 400);
    assert.equal((await sendEvent(payload, signature)).status, 200);
    assert.equal((await sendEvent(payload, signature)).status, 200);
    assert.equal(await db.stripeWebhookEvent.count({ where: { id: event.id } }), 1);
    // First-use/recreated member sequence works for concurrent registrations.
    await db.$executeRawUnsafe('DROP SEQUENCE public.user_member_code_seq');
    const { UsersService } = require('../dist/users/users.service'); const usersService = app.get(UsersService);
    const members = await Promise.all(['a', 'b'].map(n => usersService.createUser({ email: `sequence-${n}@example.test`, password: user.password })));
    assert.equal(new Set(members.map(member => member.memberCode)).size, 2);
    assert(!members.some(member => member.memberCode === user.memberCode));
    console.log('PASS: real HTTP/JWT/CSRF: registration, role injection, anonymous/user/admin permissions, foreign address, quantity/price tampering; captured email only');
    console.log('PASS: old mailbox links revoked, concurrent reset single-use, session invalidation, login/parallel refresh/logout, real local Stripe signatures and sequence recreation');
    if (process.argv.includes('--serve')) {
      const { CartService } = require('../dist/cart/cart.service');
      const { AddressesService } = require('../dist/addresses/addresses.service');
      const browserUser = await db.user.findUnique({ where: { id: user.id } });
      browserTokens = await sessions.create(browserUser);
      await app.get(CartService).addItem({ userId: user.id }, { variantId: product.variants[0].id, qty: 2 });
      await app.get(AddressesService).create(user.id, { name: 'Audit User', line1: 'Test Street 1', city: 'Madrid', zip: '28001', country: 'ES', isDefault: true });
      console.log('ISOLATED_REVIEW_READY ' + base + '/__securityreview (type stop to close)');
      await new Promise(resolve => {
        const finish = () => {
          process.stdin.removeListener('data', onData);
          process.removeListener('SIGINT', finish);
          process.stdin.pause();
          resolve();
        };
        const onData = data => { if (String(data).trim() === 'stop') finish(); };
        process.stdin.on('data', onData);
        process.once('SIGINT', finish);
      });
    }
  } finally { await app.close(); process.chdir(oldCwd); }
};
