'use strict';
// Real local PostgreSQL + simulated carrier/SMTP. Never writes the source DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const repository = path.resolve(backend, '..');
const databaseName = `cronox_tracking_test_${randomUUID().replace(/-/g, '')}`;
const reportPath = path.join(repository, 'test-results/correos-tracking-db/results.json');
const report = { database: databaseName, carrier: 'simulated-official-contract', smtp: 'stub-never-connected', checks: [], cleanedUp: false };
const deferred = () => {
  let resolve;
  const promise = new Promise(done => resolve = done);
  return { promise, resolve };
};
const event = (code, date, hours) => ({ uniqueCode: code, eventCode: code.slice(0, 3),
  eventDate: date, eventHours: hours, eventDes: `Fixture ${code}` });
const admitted = event('A010000V', '20/10/2026', '09:00:00');
const inDelivery = event('H020000V', '20/10/2026', '12:00:00');
const earlier = event('UNREVIEWED', '13/10/2026', '08:00:00');

async function run() {
  const environment = loadLocalEnvironment();
  const source = new URL(environment.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname), 'LOOPBACK_DATABASE_REQUIRED');
  assert.match(databaseName, /^cronox_tracking_test_[a-f0-9]{32}$/);
  ensureLocalPostgres(environment);
  const controlUrl = new URL(source); controlUrl.search = '';
  const control = new Client({ connectionString: controlUrl.href, connectionTimeoutMillis: 5000 });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cronox-tracking-db-'));
  let created = false, prisma, second, numberingA, numberingB;
  try {
    await control.connect();
    const identity = (await control.query('SELECT host(inet_server_addr()) AS host')).rows[0];
    assert.ok(['127.0.0.1', '::1'].includes(identity.host), 'ACTUAL_LOOPBACK_SERVER_REQUIRED');
    await control.query(`CREATE DATABASE "${databaseName}" TEMPLATE template0`);
    created = true;
    const target = new URL(source); target.pathname = '/' + databaseName; target.search = '?schema=public';
    const env = { ...environment, DATABASE_URL: target.href, DIRECT_URL: target.href,
      USER_NUMBERING_DATABASE_URL: target.href, CORREOS_TRACKING_ENABLED: 'true',
      CORREOS_EMAIL_ENABLED: 'false', CORREOS_IDENTITY_CLIENT_ID: '', CORREOS_IDENTITY_CLIENT_SECRET: '',
      CORREOS_DEVELOPERS_CLIENT_ID: '', CORREOS_DEVELOPERS_CLIENT_SECRET: '',
      CORREOS_MANUAL_COOLDOWN_SECONDS: '10', CORREOS_SYNC_CONCURRENCY: '1', CORREOS_REQUEST_SPACING_MS: '100',
      EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false', NEWSLETTER_EMAIL_WORKER_ENABLED: 'false',
      WAITLIST_EMAIL_WORKER_ENABLED: 'false', MAILBOX_WORKER_ENABLED: 'false', MAILBOX_SEND_ENABLED: 'false' };
    const setupUrl = new URL(target); setupUrl.search = '';
    const setup = new Client({ connectionString: setupUrl.href, connectionTimeoutMillis: 5000 });
    try {
      await setup.connect();
      await setup.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      // Reconstruct the immediate pre-change model, including after this test is
      // committed. The real SQL migration (not db push) must add these columns.
      const baseline = fs.readFileSync(path.join(backend, 'prisma/schema.prisma'), 'utf8')
        .replace(/^  tracking(?:AttachedAt|AdmissionLocalAt|DeliveryLocalAt|NotificationReview)\s+.*\r?\n/gm, '')
        .replace(/model OrderTrackingAudit \{[\s\S]*?\n\}/, block => block.replace(/^  (?:action|previousStatus|nextStatus)\s+.*\r?\n/gm, ''));
      const baselinePath = path.join(temporary, 'baseline.prisma');
      fs.writeFileSync(baselinePath, baseline);
      const pushed = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate', '--schema', baselinePath],
        { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
      assert.equal(pushed.status, 0, 'BASELINE_SCHEMA_INITIALIZATION_FAILED');
      await setup.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261018180000_correos_fulfillment/migration.sql'), 'utf8'));
      await setup.query(`UPDATE "CorreosTrackingGate" SET "notBefore"='2026-10-18T16:00:00Z' WHERE key='SHIPPED_EMAIL_CUTOFF'`);
      // Prisma db push creates the HEAD schema, not its historical security DDL.
      const priorMigration = fs.readFileSync(path.join(backend, 'prisma/migrations/20261016120000_correos_tracking/migration.sql'), 'utf8');
      await setup.query(priorMigration.slice(priorMigration.indexOf('DO $$'), priorMigration.indexOf('END $$;') + 'END $$;'.length));
      report.checks.push('Real additive migration applies to clean HEAD schema; source local database receives no writes');
      const tables = ['OrderTrackingEvent', 'OrderTrackingAudit', 'OrderTrackingNotification', 'OrderShippingLabel', 'CorreosTrackingGate'];
      const privacy = (await setup.query(`
        SELECT c.relname, c.relrowsecurity,
          EXISTS (SELECT 1 FROM aclexplode(COALESCE(c.relacl, acldefault('r',c.relowner))) a
            LEFT JOIN pg_roles r ON r.oid=a.grantee
            WHERE a.grantee=0 OR r.rolname IN ('anon','authenticated')) AS public_grants
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=ANY($1::text[])`, [tables])).rows;
      assert.equal(privacy.length, 5);
      assert.ok(privacy.every(table => table.relrowsecurity && !table.public_grants), 'PRIVATE_TRACKING_TABLES_REQUIRE_RLS_AND_NO_PUBLIC_GRANTS');
      for (const role of ['anon', 'authenticated']) {
        if ((await setup.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
          const privileges = await setup.query(`SELECT has_table_privilege($1, quote_ident(t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS granted FROM unnest($2::text[]) t`, [role, tables]);
          assert.ok(privileges.rows.every(row => !row.granted), 'DATA_API_ROLES_MUST_NOT_ACCESS_PRIVATE_TRACKING');
        }
      }
      report.checks.push('All five private tracking tables have RLS enabled and no PUBLIC/anon/authenticated table grants');
      const diff = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-schema-datasource', path.join(backend, 'prisma/schema.prisma'),
        '--to-schema-datamodel', path.join(backend, 'prisma/schema.prisma'), '--exit-code'],
        { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
      assert.equal(diff.status, 0, 'MIGRATED_SCHEMA_MUST_MATCH_FINAL_PRISMA');
      report.checks.push('Actual migrated schema has zero diff from final Prisma schema');
    } finally { await setup.end(); }

    Object.assign(process.env, env);
    global.fetch = async () => { throw new Error('EXTERNAL_HTTP_FORBIDDEN_IN_THIS_TEST'); };
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { TrackingService } = require('../src/shipping-tracking/tracking.service');
    const { TrackpubContract } = require('../src/shipping-tracking/trackpub.contract');
    const { AdminOrdersService } = require('../src/admin/orders/admin-orders.service');
    const { ShippingLabelsService } = require('../src/shipping-tracking/labels.service');
    const { TrackingNotificationsService } = require('../src/shipping-tracking/tracking-notifications.service');
    const { TrackingRequestGate } = require('../src/shipping-tracking/tracking-request-gate');
    const { UserNumberingGate } = require('../src/users/user-numbering-gate.module');
    const { CorreosApiError } = require('../src/shipping-tracking/trackpub.client');
    const { MeService } = require('../src/me/me.service');
    prisma = new PrismaService(); second = new PrismaService();
    await Promise.all([prisma.$connect(), second.$connect()]);
    assert.equal((await prisma.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, databaseName);
    assert.equal((await second.$queryRawUnsafe('SELECT current_database() AS name'))[0].name, databaseName);
    let smtpCalls = 0;
    const noEmail = { send: async () => { smtpCalls++; throw new Error('NO_SMTP_ALLOWED'); } };
    const actor = await prisma.user.create({ data: { email: 'admin@tracking.example.test', role: 'SUPERADMIN' } });
    const buyerA = await prisma.user.create({ data: { email: 'a@tracking.example.test' } });
    const buyerB = await prisma.user.create({ data: { email: 'b@tracking.example.test' } });
    const product = await prisma.product.create({ data: { slug: 'tracking-fixture', name: 'Tracking fixture', price: 1000,
      variants: { create: { size: 'M', sku: 'TRACKING-FIXTURE-M', stockQty: 10 } } }, include: { variants: true } });
    const order = await prisma.order.create({ data: { userId: buyerA.id, customerEmail: 'a@tracking.example.test', status: 'PAID',
      subtotal: '10.00', taxRate: '0.21', taxAmount: '1.74', total: '12.95', shippingCost: 295,
      source: 'ONLINE', shippingMethodCode: 'STANDARD', shippingCarrier: 'Correos',
      trackingNumber: 'TRACKING00001', trackingNextSyncAt: new Date(0) } });
    const contract = new TrackpubContract();
    let payload = { code: order.trackingNumber, events: [event('PRE_ADMISION', '20/10/2026', '08:00:00')] };
    const client = { search: async () => payload };
    const requests = { run: work => work() };
    const service = new TrackingService(prisma, client, contract, requests);
    const otherService = new TrackingService(second, client, contract, requests);
    const ready = async () => prisma.order.update({ where: { id: order.id }, data: {
      trackingLastSuccessAt: null, trackingLastErrorAt: null, trackingNextSyncAt: new Date(0) } });
    await service.syncOrder(order.id, true);
    assert.equal(await prisma.orderTrackingEvent.count({ where: { orderId: order.id } }), 1);
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: order.id } }), 0);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).trackingBaselineEstablished, true);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, 'PAID');
    report.checks.push('Associated label and preadmission preserve PAID without any notification');

    payload = { code: order.trackingNumber, events: [inDelivery, earlier, admitted, inDelivery] };
    await ready(); await service.syncOrder(order.id, true);
    assert.equal(await prisma.orderTrackingEvent.count({ where: { orderId: order.id } }), 4);
    const notification = await prisma.orderTrackingNotification.findFirstOrThrow({ where: { orderId: order.id } });
    assert.equal(notification.category, 'SHIPPED');
    const admittedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(admittedOrder.status, 'SHIPPED'); assert.equal(admittedOrder.shippedAt, null);
    assert.equal(admittedOrder.trackingAdmissionLocalAt, '20/10/2026 09:00:00');
    await ready(); await otherService.syncOrder(order.id, true);
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: order.id } }), 1);
    assert.equal(await prisma.orderTrackingEvent.count({ where: { orderId: order.id } }), 4);
    const view = await service.getOrderTracking(order.id);
    assert.equal(view.events[0].code, 'H020000V');
    assert.equal(view.events[3].code, 'UNREVIEWED');
    assert.equal(view.events[3].category, null);
    report.checks.push('Real PostgreSQL unique keys deduplicate repeated/out-of-order events; one new milestone creates exactly one outbox record across two clients');

    payload = { code: order.trackingNumber, events: [] };
    await ready(); await service.syncOrder(order.id, true);
    assert.equal(await prisma.orderTrackingEvent.count(), 4);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).trackingStateCode, 'H020000V');
    report.checks.push('Empty carrier response preserves the latest state and complete history');

    await ready();
    const started = deferred(), release = deferred();
    const pendingClient = { search: async () => { started.resolve(); await release.promise; return { code: order.trackingNumber, events: [inDelivery] }; } };
    const pendingService = new TrackingService(prisma, pendingClient, contract, requests);
    const pending = pendingService.syncOrder(order.id, true);
    await started.promise;
    await assert.rejects(otherService.syncOrder(order.id, true), error => error.getStatus?.() === 409);
    await assert.rejects(otherService.syncOrder(order.id, false), error => error.getStatus?.() === 409);
    release.resolve(); await pending;
    report.checks.push('A persisted lease rejects simultaneous manual and automatic requests from an independent Prisma client');

    await ready();
    const correctionStarted = deferred(), correctionRelease = deferred();
    const staleService = new TrackingService(prisma, { search: async () => {
      correctionStarted.resolve(); await correctionRelease.promise;
      return { code: order.trackingNumber, events: [event('I010000V', '14/10/2026', '15:00:00')] };
    } }, contract, requests);
    const stale = staleService.syncOrder(order.id, true);
    await correctionStarted.promise;
    const admin = new AdminOrdersService(second, {}, noEmail, {}, {});
    await admin.updateOrderFulfillment(order.id, { trackingNumber: 'TRACKING00002', trackingRevision: 0, replaceTracking: true }, actor.id);
    correctionRelease.resolve(); await stale;
    const current = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(current.trackingRevision, 1); assert.equal(current.trackingNumber, 'TRACKING00002');
    assert.equal(current.trackingLastSuccessAt, null); assert.equal(current.trackingState, null);
    assert.equal(current.trackingBaselineEstablished, false); assert.equal(current.status, 'SHIPPED');
    assert.equal(await prisma.orderTrackingEvent.count({ where: { revision: 1 } }), 0);
    assert.equal((await prisma.orderTrackingNotification.findUniqueOrThrow({ where: { id: notification.id } })).status, 'CANCELLED');
    const audit = await prisma.orderTrackingAudit.findFirstOrThrow({ where: { orderId: order.id, revision: 1 } });
    assert.equal(audit.actorId, actor.id); assert.equal(audit.actorIdentityUid, actor.identityUid);
    assert.equal(audit.previousNumber, 'TRACKING00001'); assert.equal(audit.nextNumber, 'TRACKING00002');
    assert.equal(smtpCalls, 0);
    report.checks.push('Tracking replacement during in-flight old query invalidates that response, preserves payment and cancels old emails; immutable actor UUID is audited');

    process.env.CORREOS_LABEL_PRIVATE_DIR = path.join(temporary, 'private-labels');
    const labels = new ShippingLabelsService(prisma);
    const pdf = Buffer.from('%PDF-1.7\n1 0 obj <</Type/Catalog>> endobj\n%%EOF\n');
    await labels.upload(order.id, 1, actor.id, { originalname: '../label.pdf', mimetype: 'application/pdf', buffer: pdf, size: pdf.length });
    assert.deepEqual((await labels.download(order.id)).buffer, pdf);
    await assert.rejects(labels.upload(order.id, 0, actor.id, { originalname: 'stale.pdf', mimetype: 'application/pdf', buffer: pdf, size: pdf.length }), /seguimiento ha cambiado/);
    const label = await prisma.orderShippingLabel.findUniqueOrThrow({ where: { orderId: order.id } });
    assert.equal(label.trackingRevision, 1); assert.equal(label.originalName, 'label.pdf');
    assert.equal(fs.readdirSync(process.env.CORREOS_LABEL_PRIVATE_DIR).length, 1);
    report.checks.push('Real private PDF storage/download and hash integrity work; stale-revision upload rolls back and removes its temporary file');

    numberingA = new UserNumberingGate(); numberingB = new UserNumberingGate();
    const gateA = new TrackingRequestGate(prisma, numberingA), gateB = new TrackingRequestGate(second, numberingB);
    const gateStarted = deferred(), gateRelease = deferred();
    const held = gateA.run(async () => { gateStarted.resolve(); await gateRelease.promise; return true; });
    await gateStarted.promise;
    await assert.rejects(gateB.run(async () => true), error => error.code === 'TRACKING_BUSY');
    gateRelease.resolve(); await held;
    await assert.rejects(gateB.run(async () => { throw new CorreosApiError('HTTP_429', 3000); }), error => error.code === 'HTTP_429');
    const shared = await prisma.correosTrackingGate.findUniqueOrThrow({ where: { key: 'REQUESTS' } });
    assert.ok(shared.notBefore.getTime() > Date.now() + 1500);
    await assert.rejects(gateA.run(async () => true), error => error.code === 'RATE_WAIT');
    report.checks.push('Actual PostgreSQL advisory slots limit concurrency across two independent pools; Retry-After gate is persisted and respected by the other process');

    await prisma.orderTrackingNotification.create({ data: { orderId: order.id, revision: 1, eventId: 'crash-fixture-no-smtp',
      category: 'DELIVERED', status: 'SENDING', leaseToken: 'old-process', leaseUntil: new Date(0), attempts: 1 } });
    process.env.EMAIL_ENABLED = 'true'; process.env.CORREOS_EMAIL_ENABLED = 'true'; process.env.BACKGROUND_JOBS_ENABLED = 'true';
    try { await new TrackingNotificationsService(prisma, noEmail).tick(); }
    finally { process.env.EMAIL_ENABLED = 'false'; process.env.CORREOS_EMAIL_ENABLED = 'false'; process.env.BACKGROUND_JOBS_ENABLED = 'false'; }
    assert.equal((await prisma.orderTrackingNotification.findUniqueOrThrow({ where: { eventId: 'crash-fixture-no-smtp' } })).status, 'UNKNOWN');
    assert.equal(smtpCalls, 0);
    report.checks.push('Restart recovery moves an expired SENDING outbox lease to UNKNOWN without attempting SMTP or duplicating its message');
    assert.equal((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockQty, 10);
    assert.equal(await prisma.stockMovement.count(), 0); assert.equal(await prisma.order.count(), 1);
    report.checks.push('All tracking tests preserve the original single Order and stock; no stock movement, SMTP or external HTTP occurs');

    const simple = { subtotal: '10.00', taxRate: '0.21', taxAmount: '1.74', total: '10.00', status: 'PAID' };
    const otherOrder = await prisma.order.create({ data: { ...simple, userId: buyerB.id, customerEmail: 'b@tracking.example.test', source: 'IN_PERSON_ADMIN' } });
    const pickup = await prisma.order.create({ data: { ...simple, userId: buyerA.id, customerEmail: 'a@tracking.example.test', shippingMethodCode: 'LOCAL_PICKUP' } });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'DELIVERED',
      trackingUrl: 'https://api1.correos.es/support/trackpub/api/v2/search/TRACKING00002' } });
    const me = new MeService(prisma, {});
    const ordersA = await me.getOrders(buyerA.id), ordersB = await me.getOrders(buyerB.id);
    assert.deepEqual(new Set(ordersA.map(item => item.id)), new Set([order.id, pickup.id]));
    assert.deepEqual(ordersB.map(item => item.id), [otherOrder.id]);
    assert.equal(ordersB[0].shippingRequired, false);
    assert.equal(ordersA.find(item => item.id === pickup.id).shippingRequired, false);
    const delivered = ordersA.find(item => item.id === order.id);
    assert.equal(delivered.trackingNumber, 'TRACKING00002');
    assert.equal(delivered.trackingUrl, 'https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=TRACKING00002');
    for (const item of [...ordersA, ...ordersB]) {
      for (const key of ['shippingLabel', 'storageKey', 'trackingAudits', 'customerEmail', 'shippingAddr', 'sha256']) assert.ok(!(key in item));
    }
    assert.ok(!JSON.stringify(ordersA).includes(label.storageKey));
    report.checks.push('Real MeService scopes orders to the authenticated user; private labels/audits do not leak; pickup/manual orders and delivered public tracking links stay correct');

    const initiallyEmpty = await prisma.order.create({ data: { ...simple, customerEmail: 'empty@tracking.example.test',
      source: 'ONLINE', shippingMethodCode: 'STANDARD', shippingCarrier: 'Correos', trackingNumber: 'EMPTY00001' } });
    let emptyPayload = { code: initiallyEmpty.trackingNumber, events: [] };
    const emptyService = new TrackingService(prisma, { search: async () => emptyPayload }, contract, requests);
    const readyEmpty = () => prisma.order.update({ where: { id: initiallyEmpty.id }, data: {
      trackingLastSuccessAt: null, trackingLastErrorAt: null, trackingNextSyncAt: new Date(0) } });
    await emptyService.syncOrder(initiallyEmpty.id);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: initiallyEmpty.id } })).trackingBaselineEstablished, true);
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: initiallyEmpty.id } }), 0);
    emptyPayload = { code: initiallyEmpty.trackingNumber, events: [admitted] };
    await readyEmpty(); await emptyService.syncOrder(initiallyEmpty.id);
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: initiallyEmpty.id, category: 'SHIPPED' } }), 1);
    report.checks.push('An initial empty successful response establishes the baseline, so the first later admission queues exactly one new notification');

    const sameSecondMilestone = event('H020000V', '20/10/2026', '09:00:00');
    emptyPayload = { code: initiallyEmpty.trackingNumber, events: [admitted, sameSecondMilestone] };
    await readyEmpty(); await emptyService.syncOrder(initiallyEmpty.id);
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: initiallyEmpty.id, category: 'OUT_FOR_DELIVERY' } }), 0);
    await readyEmpty(); await emptyService.syncOrder(initiallyEmpty.id);
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: initiallyEmpty.id } }), 1);
    report.checks.push('Later and repeated milestones at the same second never create another shipment notice');

    emptyPayload = { code: initiallyEmpty.trackingNumber, events: [admitted, sameSecondMilestone, event('H250000V', '15/10/2026', '09:00:00')] };
    await readyEmpty(); await emptyService.syncOrder(initiallyEmpty.id);
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: initiallyEmpty.id } }), 1);
    report.checks.push('Distinct delivery milestones remain in history without sending additional mail');

    await prisma.order.updateMany({ where: { shippingCarrier: 'Correos' }, data: { trackingNextSyncAt: new Date(Date.now() + 60000) } });
    for (let index = 0; index < 4; index++) {
      await prisma.order.create({ data: { ...simple, customerEmail: 'pickup@tracking.example.test', shippingCarrier: 'Correos',
        trackingNumber: 'PICKUP0000' + index, shippingMethodCode: index % 2 ? 'PICKUP' : 'LOCAL_PICKUP', trackingNextSyncAt: new Date(0) } });
    }
    const standard = await prisma.order.create({ data: { ...simple, customerEmail: 'standard@tracking.example.test', shippingCarrier: 'Correos',
      trackingNumber: 'STANDARD00001', shippingMethodCode: 'STANDARD', trackingNextSyncAt: new Date(1000) } });
    const queried = [];
    const automatic = new TrackingService(prisma, { search: async number => { queried.push(number); return { code: number, events: [] }; } }, contract, requests);
    await automatic.synchronizeDue();
    assert.deepEqual(queried, [standard.trackingNumber]);
    assert.ok((await prisma.order.findUniqueOrThrow({ where: { id: standard.id } })).trackingLastSuccessAt);
    assert.equal(await prisma.order.count({ where: { shippingMethodCode: { in: ['LOCAL_PICKUP', 'PICKUP'] }, trackingLastSuccessAt: { not: null } } }), 0);
    assert.equal(smtpCalls, 0);
    report.checks.push('Older assigned local-pickup rows cannot consume the limited candidate batch and starve a later eligible STANDARD shipment');
    const createFixture = (trackingNumber, extra = {}) => prisma.order.create({ data: { ...simple,
      customerEmail: 'isolated@tracking.example.test', source: 'ONLINE', shippingMethodCode: 'STANDARD',
      shippingCarrier: 'Correos', trackingNumber, createdAt: new Date('2026-10-10T00:00:00Z'), ...extra } });
    const historical = await createFixture('HISTORICAL0001');
    const queryFixture = (target, events, database = prisma) => new TrackingService(database, { search: async () => ({ code: target.trackingNumber, events }) }, contract, requests);
    await queryFixture(historical, [event('A010000V', '14/10/2026', '09:00:00')]).syncOrder(historical.id);
    const historicalView = await prisma.order.findUniqueOrThrow({ where: { id: historical.id } });
    assert.equal(historicalView.status, 'SHIPPED'); assert.equal(historicalView.trackingNotificationReview, 'HISTORICAL_ADMISSION');
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: historical.id } }), 0);
    report.checks.push('Historical first admission updates fulfillment but permanently retains its notice for review without enqueueing');

    const advanced = await createFixture('ADVANCED0001');
    await queryFixture(advanced, [event('I010000V', '21/10/2026', '12:00:00'), admitted, inDelivery]).syncOrder(advanced.id);
    let advancedView = await prisma.order.findUniqueOrThrow({ where: { id: advanced.id } });
    assert.equal(advancedView.status, 'DELIVERED'); assert.equal(advancedView.trackingAdmissionLocalAt, '20/10/2026 09:00:00');
    assert.equal(advancedView.trackingDeliveryLocalAt, '21/10/2026 12:00:00'); assert.equal(advancedView.shippedAt, null);
    await prisma.order.update({ where: { id: advanced.id }, data: { trackingLastSuccessAt: null } });
    await queryFixture(advanced, [event('PRE_ADMISION', '22/10/2026', '12:00:00')]).syncOrder(advanced.id);
    advancedView = await prisma.order.findUniqueOrThrow({ where: { id: advanced.id } });
    assert.equal(advancedView.status, 'DELIVERED'); assert.equal(advancedView.trackingState, 'Entregado');
    assert.equal(await prisma.orderTrackingNotification.count({ where: { orderId: advanced.id } }), 0);
    report.checks.push('Advanced first delivery uses available admission/delivery history and never regresses on later contradictory preadmission or invents UTC dates');

    const transit = await createFixture('TRANSIT0001');
    await queryFixture(transit, [event('C010000V', '20/10/2026', '11:00:00')]).syncOrder(transit.id);
    const transitView = await prisma.order.findUniqueOrThrow({ where: { id: transit.id } });
    assert.equal(transitView.status, 'SHIPPED'); assert.equal(transitView.shippedAt, null);
    assert.equal(transitView.trackingAdmissionLocalAt, null); assert.equal(transitView.trackingNotificationReview, 'ADMISSION_DATE_MISSING');
    report.checks.push('First transit without admission still proves physical shipment but invents neither admission date nor a historical notice');

    const cancelledFlight = await createFixture('CANCELFLIGHT0001');
    const flightStarted = deferred(), flightRelease = deferred();
    const flight = new TrackingService(prisma, { search: async () => { flightStarted.resolve(); await flightRelease.promise; return { code: cancelledFlight.trackingNumber, events: [admitted] }; } }, contract, requests).syncOrder(cancelledFlight.id);
    await flightStarted.promise;
    await second.order.update({ where: { id: cancelledFlight.id }, data: { status: 'CANCELLED' } });
    flightRelease.resolve(); await flight;
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: cancelledFlight.id } })).status, 'CANCELLED');
    assert.equal(await prisma.orderTrackingEvent.count({ where: { orderId: cancelledFlight.id } }), 0);
    report.checks.push('Cancellation while Trackpub is in flight is rechecked under row lock before any fulfillment/event/mail mutation');

    const failures = await createFixture('FAILURE00001');
    const failureService = new TrackingService(prisma, { search: async () => { throw new CorreosApiError('TRACKPUB_HTTP_429', 3600000); } }, contract, requests);
    await assert.rejects(failureService.syncOrder(failures.id), error => error.getStatus?.() === 503);
    const failed = await prisma.order.findUniqueOrThrow({ where: { id: failures.id } });
    assert.equal(failed.status, 'PAID'); assert.equal(failed.trackingNumber, failures.trackingNumber);
    assert.ok(failed.trackingNextSyncAt.getTime() > Date.now() + 3500000);
    await prisma.order.update({ where: { id: failures.id }, data: { trackingLastErrorAt: null } });
    await queryFixture(failures, [admitted]).syncOrder(failures.id);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: failures.id } })).trackingLastErrorCode, null);
    report.checks.push('Rate-limit errors preserve identity and state, persist Retry-After, and recover on later successful admission');

    const blankA = await createFixture(null), blankB = await createFixture(null);
    const conflicted = await admin.assignTrackingBulk([{ orderId: blankA.id, trackingNumber: 'DUPLICATE001' }, { orderId: blankA.id, trackingNumber: 'DUPLICATE002' }, { orderId: blankB.id, trackingNumber: 'DUPLICATE002' }], true, actor.id);
    assert.ok(conflicted.results.every(r => r.status === 'error'));
    const batch = await admin.assignTrackingBulk([{ orderId: blankA.id, trackingNumber: 'BATCH00001' }, { orderId: 0, trackingNumber: 'BAD' }, { orderId: otherOrder.id, trackingNumber: 'MANUAL0001' }, { orderId: blankB.id, trackingNumber: order.trackingNumber }], true, actor.id);
    assert.deepEqual(batch.results.map(r => r.status), ['valid', 'error', 'error', 'valid']);
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: blankA.id } })).trackingNumber, null);
    const savedBatch = await admin.assignTrackingBulk([{ orderId: blankA.id, trackingNumber: 'BATCH00001', revision: 0 }], false, actor.id);
    assert.equal(savedBatch.results[0].status, 'updated');
    const repeatedBatch = await admin.assignTrackingBulk([{ orderId: blankA.id, trackingNumber: 'BATCH00001', revision: 1 }], false, actor.id);
    assert.equal(repeatedBatch.results[0].status, 'unchanged');
    const duplicateBatch = await admin.assignTrackingBulk([{ orderId: blankB.id, trackingNumber: 'BATCH00001', revision: 0 }], false, actor.id);
    assert.equal(duplicateBatch.results[0].status, 'error');
    const staleBatch = await admin.assignTrackingBulk([{ orderId: blankA.id, trackingNumber: 'BATCH00001', revision: 0 }], false, actor.id);
    assert.equal(staleBatch.results[0].status, 'error');
    report.checks.push('Mixed bulk preview validates exact order IDs per row without writes; save/replay gives updated/unchanged and rejects in-person or duplicate assignments');

    const raceA = await createFixture(null), raceB = await createFixture(null);
    const adminA = new AdminOrdersService(prisma, {}, noEmail, {}, {});
    const assignmentRace = await Promise.allSettled([adminA.updateOrderFulfillment(raceA.id, { trackingNumber: 'RACECODE0001', trackingRevision: 0 }, actor.id), admin.updateOrderFulfillment(raceB.id, { trackingNumber: 'RACECODE0001', trackingRevision: 0 }, actor.id)]);
    assert.equal(assignmentRace.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(await prisma.order.count({ where: { trackingNumber: 'RACECODE0001' } }), 1);
    await assert.rejects(second.order.update({ where: { id: raceB.id }, data: { trackingNumber: 'BATCH00001' } }), error => error.code === 'P2002');
    report.checks.push('Two independent assignments race for the same code: only one commits; database unique index also rejects direct duplicate writes');

    let accepted = 0;
    const mail = { send: async () => { accepted++; return { messageId: 'SIMULATED_ONLY' }; } };
    process.env.EMAIL_ENABLED = 'true'; process.env.CORREOS_EMAIL_ENABLED = 'true'; process.env.BACKGROUND_JOBS_ENABLED = 'true';
    const notice = await prisma.orderTrackingNotification.findFirstOrThrow({ where: { orderId: initiallyEmpty.id, category: 'SHIPPED' } });
    await Promise.all([new TrackingNotificationsService(prisma, mail).deliver(notice.id), new TrackingNotificationsService(second, mail).deliver(notice.id)]);
    assert.equal(accepted, 1);
    assert.equal((await prisma.orderTrackingNotification.findUniqueOrThrow({ where: { id: notice.id } })).status, 'SENT');
    report.checks.push('Two real database clients delivering one shipment outbox record invoke the simulated sender exactly once');
    assert.equal(smtpCalls, 0); assert.equal(await prisma.stockMovement.count(), 0);
    report.passed = true;
  } finally {
    await Promise.all([prisma?.$disconnect(), second?.$disconnect(), numberingA?.onModuleDestroy(), numberingB?.onModuleDestroy()]);
    if (created) {
      assert.match(databaseName, /^cronox_tracking_test_[a-f0-9]{32}$/);
      assert.notEqual('/' + databaseName, source.pathname, 'SOURCE_DATABASE_MUST_NEVER_BE_DROPPED');
      await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()', [databaseName]);
      await control.query(`DROP DATABASE "${databaseName}"`);
      report.cleanedUp = true;
    }
    await control.end();
    const resolvedTemporary = path.resolve(temporary);
    assert.equal(path.dirname(resolvedTemporary), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolvedTemporary).startsWith('cronox-tracking-db-'));
    fs.rmSync(resolvedTemporary, { force: true, recursive: true });
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  }
}
run().then(() => console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, cleanedUp: report.cleanedUp, reportPath })))
  .catch(error => {
    // Never print connection strings, raw provider responses or credentials.
    console.error('CORREOS_LOCAL_DB_TEST_FAILED:' + (error.code || (error instanceof assert.AssertionError ? error.message : 'REVIEW_PRIVATE_LOCAL_REPORT')));
    process.exitCode = 1;
  });
