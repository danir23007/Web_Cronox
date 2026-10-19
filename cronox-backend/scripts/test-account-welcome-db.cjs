'use strict';
// Disposable loopback database. Email delivery is an in-memory transport only.
const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs');
const { spawnSync } = require('node:child_process'),
  { randomUUID, createHash } = require('node:crypto'),
  { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..'),
  name = 'cronox_welcome_test_' + randomUUID().replace(/-/g, '');
const checks = [];
(async () => {
  const env = loadLocalEnvironment(),
    source = new URL(env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  const control = new Client({ connectionString: source.href });
  let created = false,
    db;
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
      EMAIL_ENABLED: 'false',
      BACKGROUND_JOBS_ENABLED: 'false',
      NEWSLETTER_EMAIL_WORKER_ENABLED: 'false',
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
    assert.equal(push.status, 0, 'Disposable schema setup failed');
    require('../test/test-environment.cjs').installTestEnvironment({
      overrides,
    });
    require('ts-node').register({
      project: path.join(backend, 'tsconfig.json'),
      transpileOnly: true,
    });
    const { PrismaService } = require('../src/prisma/prisma.service'),
      { UsersService } = require('../src/users/users.service');
    const {
        NewsletterService,
      } = require('../src/newsletter/newsletter.service'),
      {
        NewsletterDeliveryService,
      } = require('../src/newsletter/newsletter-delivery.service');
    const { AuthService } = require('../src/auth/auth.service'),
      { KeyScreenService } = require('../src/key-screen/key-screen.service');
    const {
        GuestOrderAccountService,
      } = require('../src/orders/guest-order-account.service'),
      { AdminUsersService } = require('../src/admin/users/admin-users.service');
    const { OrdersService } = require('../src/orders/orders.service'),
      { ensureAccountWelcome } = require('../src/users/account-welcome');
    db = new PrismaService();
    await db.$connect();
    assert.equal(
      (await db.$queryRawUnsafe('SELECT current_database() AS name'))[0].name,
      name,
    );
    await db.userNumberingState.create({
      data: { id: 1, nextId: 1, ready: true },
    });
    const numbering = fs.readFileSync(
      path.join(
        backend,
        'prisma/migrations/20261008190000_consecutive_user_numbers/migration.sql',
      ),
      'utf8',
    );
    const numberingClient = new Client({ connectionString: target.href });
    await numberingClient.connect();
    try {
      await numberingClient.query(
        numbering.slice(
          numbering.indexOf('CREATE FUNCTION cronox_user_number_code'),
          numbering.indexOf('CREATE FUNCTION cronox_user_number_plan'),
        ),
      );
      await numberingClient.query(
        numbering.slice(
          numbering.indexOf('CREATE FUNCTION cronox_number_user()'),
          numbering.indexOf('CREATE FUNCTION cronox_lock_user_deletion()'),
        ),
      );
      await numberingClient.query(
        'CREATE TRIGGER "User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user()',
      );
    } finally {
      await numberingClient.end();
    }
    const deliveries = [],
      email = {
        sendNewsletterWelcome: async (to, code) => { deliveries.push({ to, code }); return { messageId: 'SIMULATED-ACCEPTANCE' }; },
        isEnabled: () => false,
      };
    const users = new UsersService(db),
      newsletter = new NewsletterService(db, email),
      auth = new AuthService(users, {}, db, email, newsletter, {
        create: async () => ({ accessToken: 'local-simulated' }),
      });
    const register = (email) =>
      auth.register({
        email,
        password: 'ValidPassword1!',
        firstName: 'Local',
        lastName: 'Welcome',
      });
    const check = async (email, consent = false) => {
      const u = await db.user.findUniqueOrThrow({ where: { email } });
      assert.ok(u.firstOrderDiscountCode);
      assert.equal(u.newsletterSubscribed, consent);
      const p = await db.promoCode.findUniqueOrThrow({
        where: { code: u.firstOrderDiscountCode },
      });
      assert.equal(p.ownerEmail, email);
      assert.equal(p.firstOrderOnly, true);
      assert.equal(p.usageLimit, 1);
      assert.equal(p.singleUsePerUser, true);
      assert.equal(
        await db.discountCode.count({
          where: { userId: u.id, type: 'FIRST_ORDER' },
        }),
        1,
      );
      assert.equal(
        await db.newsletterMailJob.count({ where: { email, kind: 'WELCOME' } }),
        1,
      );
      return u;
    };
    const registered = await register('register@welcome.test');
    const first = await check('register@welcome.test');
    assert.equal(
      registered.user.firstOrderDiscountCode,
      first.firstOrderDiscountCode,
    );
    assert.equal(
      await db.newsletterSubscription.count({ where: { email: first.email } }),
      0,
    );
    assert.equal(
      (await new AdminUsersService(db).getUserById(first.id)).user.welcomeCode,
      first.firstOrderDiscountCode,
    );
    await newsletter.subscribe(first.email);
    assert.equal(
      (await check(first.email, true)).firstOrderDiscountCode,
      first.firstOrderDiscountCode,
    );
    await newsletter.subscribe('newsletter@welcome.test');
    const opted = await check('newsletter@welcome.test', true);
    await register(opted.email);
    assert.equal(
      (await check(opted.email, true)).firstOrderDiscountCode,
      opted.firstOrderDiscountCode,
    );
    await Promise.all([
      register('concurrent@welcome.test'),
      newsletter.subscribe('concurrent@welcome.test'),
    ]);
    await check('concurrent@welcome.test', true);
    const brokenQueue = {
      $transaction: (callback) =>
        db.$transaction((tx) =>
          callback({
            ...tx,
            $executeRaw: tx.$executeRaw.bind(tx),
            $queryRaw: tx.$queryRaw.bind(tx),
            newsletterMailJob: {
              ...tx.newsletterMailJob,
              create: (args) =>
                tx.newsletterMailJob.create({
                  data: { ...args.data, userId: -1 },
                }),
            },
          }),
        ),
    };
    const countBefore = await db.promoCode.count();
    await assert.rejects(
      new UsersService(brokenQueue).createUser({
        email: 'rollback@welcome.test',
        password: 'local-test-hash',
      }),
      (error) => error.code === 'P2003',
    );
    assert.equal(
      await db.user.count({ where: { email: 'rollback@welcome.test' } }),
      0,
    );
    assert.equal(await db.promoCode.count(), countBefore);
    assert.equal(
      await db.newsletterMailJob.count({
        where: { email: 'rollback@welcome.test' },
      }),
      0,
    );
    checks.push(
      'A real outbox FK failure rolls back account, code and welcome together',
    );
    checks.push(
      'Registration and newsletter in either order reuse one persisted personal code and one welcome; account creation never adds consent',
    );
    const screen = await db.keyScreen.create({
      data: {
        internalName: 'Disposable preregistration',
        mode: 'PREREGISTRATION',
      },
    });
    await db.keyScreenSettings.create({
      data: { id: 'global', enabled: true, activeScreenId: screen.id },
    });
    await new KeyScreenService(db, null, email).preregister(
      'screen@welcome.test',
    );
    const pre = await check('screen@welcome.test');
    const raw = 'a'.repeat(64);
    await db.preRegistration.update({
      where: { userId: pre.id },
      data: {
        launchTokenHash: createHash('sha256').update(raw).digest('hex'),
        launchTokenExpiresAt: new Date(Date.now() + 60000),
      },
    });
    await auth.consumeLaunchLink(raw);
    assert.equal(
      (await check(pre.email)).firstOrderDiscountCode,
      pre.firstOrderDiscountCode,
    );
    const guest = await db.$transaction((tx) =>
      new GuestOrderAccountService().resolveUserForCompletedOrder(tx, {
        userId: null,
        customerEmail: 'guest@welcome.test',
        shippingAddr: null,
        billingAddr: null,
      }),
    );
    const gu = await check('guest@welcome.test');
    assert.equal(gu.id, guest.userId);
    const token = 'b'.repeat(64);
    await db.passwordResetToken.create({
      data: {
        userId: gu.id,
        token: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    await auth.resetPassword(token, 'ValidPassword2!');
    assert.equal(
      (await check(gu.email)).firstOrderDiscountCode,
      gu.firstOrderDiscountCode,
    );
    const admin = await db.user.create({
      data: { email: 'admin@welcome.test', role: 'SUPERADMIN' },
    });
    await new AdminUsersService(db).updateAdminUser(
      gu.id,
      {
        expectedUpdatedAt: (
          await db.user.findUniqueOrThrow({ where: { id: gu.id } })
        ).updatedAt.toISOString(),
        accountState: 'ACTIVE',
      },
      admin.id,
    );
    assert.equal(
      (await check(gu.email)).firstOrderDiscountCode,
      gu.firstOrderDiscountCode,
    );
    checks.push(
      'Preregistration, launch activation, guest paid-account creation, password setup and administrator activation reuse the same benefit without another welcome',
    );
    await Promise.all(
      Array.from({ length: 6 }, () =>
        db.$transaction((tx) => ensureAccountWelcome(tx, first.id, true), {
          timeout: 30000,
        }),
      ),
    );
    await check(first.email, true);
    const existing = await db.user.create({
      data: {
        email: 'existing@welcome.test',
        firstOrderDiscountCode: 'KEEP01',
      },
    });
    await db.promoCode.create({
      data: {
        code: 'KEEP01',
        type: 'PERCENT',
        value: 10,
        ownerEmail: existing.email,
        firstOrderOnly: true,
        singleUsePerUser: true,
        usageLimit: 1,
      },
    });
    await db.$transaction((tx) => ensureAccountWelcome(tx, existing.id));
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: existing.id } }))
        .firstOrderDiscountCode,
      'KEEP01',
    );
    assert.equal(
      await db.newsletterMailJob.count({ where: { email: existing.email } }),
      0,
    );
    checks.push(
      'Concurrent retries create no duplicates; repaired existing code is retained without retroactive delivery',
    );
    const used = await db.user.create({ data: { email: 'used@welcome.test' } });
    await db.discountCode.create({
      data: {
        code: 'USED01',
        type: 'FIRST_ORDER',
        percent: 10,
        userId: used.id,
        used: true,
        usedAt: new Date(),
      },
    });
    await db.$transaction((tx) => ensureAccountWelcome(tx, used.id));
    const usedUser = await db.user.findUniqueOrThrow({
      where: { id: used.id },
    });
    assert.equal(usedUser.firstOrderDiscountCode, 'USED01');
    assert.equal(usedUser.firstOrderDiscountUsed, true);
    assert.equal(
      (await db.promoCode.findUniqueOrThrow({ where: { code: 'USED01' } }))
        .isActive,
      false,
    );
    assert.equal(
      await db.newsletterMailJob.count({ where: { email: used.email } }),
      0,
    );
    checks.push(
      'A consumed legacy code is reused as consumed and never reactivated or mailed retroactively; profile/admin use the persisted account code',
    );
    const { repairNewsletterUsers } = require('../src/newsletter/newsletter-user-repair');
    await db.newsletterSubscription.create({ data: { email: 'historical@welcome.test', subscribedAt: new Date() } });
    await repairNewsletterUsers(db, true);
    assert.equal(await db.newsletterMailJob.count({ where: { email: 'historical@welcome.test' } }), 0);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: existing.id } })).firstOrderDiscountCode, 'KEEP01');
    checks.push('Historical link repair in the disposable database schedules no retrospective welcome and preserves repaired codes');
    const firstJob = await db.newsletterMailJob.findFirstOrThrow({ where: { userId: first.id, kind: 'WELCOME' } });
    const firstAcceptedAt = new Date();
    await db.newsletterMailJob.update({ where: { id: firstJob.id }, data: { status: 'SENT', sentAt: firstAcceptedAt } });
    await db.accountWelcomeBenefit.update({ where: { userId: first.id }, data: { sentAt: firstAcceptedAt, smtpMessageId: 'SIMULATED-PRIOR-ACCEPTANCE' } });
    const order = await db.order.create({
      data: {
        userId: first.id,
        customerEmail: first.email,
        paidAt: new Date(),
        source: 'IN_PERSON_ADMIN',
        status: 'PAID',
        subtotal: 50,
        total: 50,
        shippingCost: 0,
        taxRate: 0.21,
        taxAmount: 8.68,
      },
    });
    const context = Object.create(OrdersService.prototype);
    context.prisma = db;
    const promo = await db.promoCode.findUniqueOrThrow({
      where: { code: first.firstOrderDiscountCode },
    });
    assert.equal(
      (await context.validatePromoAvailability(promo, { userId: first.id }))
        .valid,
      true,
    );
    assert.equal(
      (
        await context.validatePromoAvailability(promo, {
          customerEmail: first.email,
        })
      ).valid,
      true,
    );
    assert.equal(
      (await context.validatePromoAvailability(promo, { userId: gu.id })).valid,
      false,
    );
    await db.order.update({
      where: { id: order.id },
      data: { source: 'ONLINE', status: 'PENDING' },
    });
    assert.equal(
      (await context.validatePromoAvailability(promo, { userId: first.id }))
        .valid,
      true,
    );
    await db.order.update({
      where: { id: order.id },
      data: { status: 'CANCELLED' },
    });
    assert.equal(
      (await context.validatePromoAvailability(promo, { userId: first.id }))
        .valid,
      true,
    );
    await db.order.update({
      where: { id: order.id },
      data: { status: 'PAID' },
    });
    assert.equal(
      (await context.validatePromoAvailability(promo, { userId: first.id }))
        .valid,
      false,
    );
    await db.order.update({
      where: { id: order.id },
      data: { status: 'REFUNDED' },
    });
    assert.equal(
      (await context.validatePromoAvailability(promo, { userId: first.id }))
        .valid,
      false,
    );
    await db.order.update({
      where: { id: order.id },
      data: {
        source: 'IN_PERSON_ADMIN',
        status: 'PAID',
        promoCodeId: promo.id,
      },
    });
    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    // Exercise the real atomic redemption once for an ONLINE order.
    await db.order.update({
      where: { id: order.id },
      data: { source: 'ONLINE' },
    });
    await db.$transaction((tx) =>
      context.handlePromoUsageOnPaid(tx, { ...paid, source: 'ONLINE' }),
    );
    await db.$transaction((tx) => ensureAccountWelcome(tx, first.id, true));
    assert.equal(
      (await db.promoCode.findUniqueOrThrow({ where: { id: promo.id } }))
        .usageCount,
      1,
    );
    assert.equal(
      (await context.validatePromoAvailability(promo, { userId: first.id }))
        .valid,
      false,
    );
    assert.equal(
      (await db.discountCode.findUniqueOrThrow({ where: { code: promo.code } }))
        .used,
      true,
    );
    checks.push(
      'Physical/manual orders do not block first ONLINE order; pending/cancelled states remain eligible; online paid/refunded and consumed discounts remain blocked',
    );
    const worker = new NewsletterDeliveryService(db, email),
      job = await db.newsletterMailJob.findFirstOrThrow({
        where: { email: opted.email, kind: 'WELCOME' },
      });
    await db.newsletterMailJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', claimToken: 'local-claim' },
    });
    await Promise.all([
      worker.dispatch(job.id, 'local-claim'),
      worker.dispatch(job.id, 'local-claim'),
    ]);
    assert.deepEqual(deliveries, [
      { to: opted.email, code: opted.firstOrderDiscountCode },
    ]);
    assert.equal(
      (await db.newsletterMailJob.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
      'SENT',
    );
    const withoutConsent = await db.newsletterMailJob.findFirstOrThrow({
      where: { email: pre.email, kind: 'WELCOME' },
    });
    await db.newsletterMailJob.update({
      where: { id: withoutConsent.id },
      data: { status: 'PROCESSING', claimToken: 'local-claim' },
    });
    await worker.dispatch(withoutConsent.id, 'local-claim');
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[1].code, pre.firstOrderDiscountCode);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: pre.id } }))
        .newsletterSubscribed,
      false,
    );
    checks.push(
      'Simulated delivery uses stored personal code without newsletter consent; concurrent dispatch sends once',
    );
    const retryUser = await users.createUser({
        email: 'retry@welcome.test',
        password: 'local-test-hash',
      }),
      retryJob = await db.newsletterMailJob.findFirstOrThrow({
        where: { email: retryUser.email, kind: 'WELCOME' },
      });
    const rejecting = new NewsletterDeliveryService(db, {
      sendNewsletterWelcome: async () => {
        throw Error('Simulated SMTP rejection');
      },
    });
    await db.newsletterMailJob.update({
      where: { id: retryJob.id },
      data: { status: 'PROCESSING', claimToken: 'reject', attempts: 1 },
    });
    await rejecting.dispatch(retryJob.id, 'reject');
    const queued = await db.newsletterMailJob.findUniqueOrThrow({
      where: { id: retryJob.id },
    });
    assert.equal(queued.status, 'QUEUED');
    assert.equal(queued.userId, retryUser.id);
    await db.newsletterMailJob.update({
      where: { id: retryJob.id },
      data: { status: 'PROCESSING', claimToken: 'retry', attempts: 2 },
    });
    await worker.dispatch(retryJob.id, 'retry');
    assert.equal(deliveries[2].code, retryUser.firstOrderDiscountCode);
    assert.equal(
      await db.newsletterSubscription.count({
        where: { email: retryUser.email },
      }),
      0,
    );
    checks.push(
      'Definite simulated delivery failure retains the account and code for a safe retry without consent or duplicate jobs',
    );
  } finally {
    if (db) await db.$disconnect();
    if (created) {
      assert.match(name, /^cronox_welcome_test_[a-f0-9]{32}$/);
      await control.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
    await control.end();
  }
  fs.mkdirSync(path.resolve(backend, '../test-results/account-welcome'), {
    recursive: true,
  });
  const report = {
    passed: true,
    cleanedUp: true,
    transport: 'in-memory',
    checks,
  };
  fs.writeFileSync(
    path.resolve(backend, '../test-results/account-welcome/results.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
})().catch((e) => {
  console.error(e.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]'));
  process.exitCode = 1;
});
