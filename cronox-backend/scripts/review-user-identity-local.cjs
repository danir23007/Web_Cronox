// Disposable loopback PostgreSQL only. No .env, credentials or mail transports.
'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os'), net = require('node:net');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const backend = path.resolve(__dirname, '..');
const out = path.resolve(backend, '../output/playwright/user-identity');
const bin = process.env.CRONOX_REVIEW_PG_BIN || 'C:/Program Files/PostgreSQL/17/bin';
const exe = n => path.join(bin, n + (process.platform === 'win32' ? '.exe' : ''));
const run = (command, args, options = {}) => execFileSync(command, args, { windowsHide: true, stdio: 'pipe', ...options });
async function main() {
  // This entry point also follows the new numbering policy. Keep the historical
  // stable-number scenario below for old schemas; never reapply its old triggers
  // or deletion assumptions against a consecutively numbered application.
  const currentSchema = await fs.readFile(path.join(backend, 'prisma/schema.prisma'), 'utf8');
  if (currentSchema.includes('model UserNumberingState')) {
    run(process.execPath, [path.join(__dirname, 'review-user-numbering-local.cjs')], { cwd: backend, stdio: 'inherit' });
    return;
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cronox-identity-'));
  const data = path.join(dir, 'pg');
  const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const url = `postgresql://cronox_identity@127.0.0.1:${port}/postgres`;
  const env = require('../test/test-environment.cjs').withTestEnvironment({}, { force: true });
  Object.assign(process.env, env, { DATABASE_URL: url, DIRECT_URL: url, CRONOX_ENV_FILE: path.join(dir, 'absent.env'), BACKGROUND_JOBS_ENABLED: 'false' });
  run(exe('initdb'), ['-D', data, '-U', 'cronox_identity', '-A', 'trust', '--encoding=UTF8', '--locale=C']);
  run(exe('pg_ctl'), ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start'], { stdio: 'ignore' });
  let db;
  try {
    let schema = await fs.readFile(path.join(backend, 'prisma/schema.prisma'), 'utf8');
    schema = schema.replace(/model UserIdentityReservation \{[\s\S]*?\n\}/, '').replace(/^.*newsletterSubscriptions.*\r?\n/m, '');
    schema = schema.replace(/model NewsletterSubscription \{[\s\S]*?\n\}/, section => section.replace(/^.*(?:userId|user\s+User\?).*\r?\n/gm, ''));
    const schemaPath = path.join(dir, 'before.prisma'); await fs.writeFile(schemaPath, schema);
    const sql = run(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaPath, '--script'], { cwd: dir, env: process.env });
    const baseline = path.join(dir, 'baseline.sql'); await fs.writeFile(baseline, 'CREATE EXTENSION IF NOT EXISTS pg_trgm;\n' + sql);
    run(exe('psql'), [url, '-v', 'ON_ERROR_STOP=1', '-f', baseline]);
    const runtimePath = require.resolve('@prisma/client/runtime/library.js'), runtime = require(runtimePath);
    require.cache[runtimePath].exports = new Proxy(runtime, { get(target, key) {
      if (key === 'warnEnvConflicts') return () => {};
      if (key === 'getPrismaClient') return config => target.getPrismaClient({ ...config, relativeEnvPaths: {} });
      return Reflect.get(target, key);
    } });
    const { PrismaClient } = require('@prisma/client'); db = new PrismaClient({ datasources: { db: { url } } });
    const old = await db.user.create({ data: { email: '  OLD@Example.test ', memberCode: 'CRX-000050', publicMemberToken: 'previous-issued-token' } });
    const other = await db.user.create({ data: { email: 'other@example.test', memberCode: '000007', accountState: 'PENDING_PASSWORD' } });
    await db.$executeRaw`INSERT INTO "NewsletterSubscription" (id,email,"subscribedAt","updatedAt") VALUES ('orphan','orphan@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('existing','old@example.test',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('pending','pending@example.test',NULL,CURRENT_TIMESTAMP)`;
    const { auditNewsletterUsers, repairNewsletterUsers } = require('../dist/newsletter/newsletter-user-repair');
    const before = await auditNewsletterUsers(db);
    assert.deepEqual(before.confirmedWithoutAccount, ['orphan']);
    assert.equal(before.unconfirmed, 1);
    assert(before.needsLink.includes('existing'));
    const migration = path.join(backend, 'prisma/migrations/20261008120000_stable_user_identity_newsletter_link/migration.sql');
    run(exe('psql'), [url, '-v', 'ON_ERROR_STOP=1', '-f', migration]);
    run(exe('psql'), [url, '-v', 'ON_ERROR_STOP=1', '-f', path.join(backend, 'prisma/migrations/20261008121000_prevent_deleted_user_id_reuse/migration.sql')]);
    const { NewsletterService } = require('../dist/newsletter/newsletter.service');
    const { UsersService } = require('../dist/users/users.service');
    const { AdminUsersService } = require('../dist/admin/users/admin-users.service');
    const service = new NewsletterService(db, { sendNewsletterWelcome() { throw new Error('Mail prohibited'); } });
    const users = new UsersService(db), admin = new AdminUsersService(db);
    // Simulate account creation failure after consent upsert: no partial acceptance.
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_fixture_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture account creation failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER "User_fixture_failure" BEFORE INSERT ON "User" FOR EACH ROW WHEN (NEW.email = 'failure@example.test') EXECUTE FUNCTION reject_fixture_account()`);
    await assert.rejects(() => service.subscribe('failure@example.test'));
    assert.equal(await db.newsletterSubscription.count({ where: { email: 'failure@example.test' } }), 0);
    assert.equal(await db.newsletterMailJob.count({ where: { email: 'failure@example.test' } }), 0);
    await db.$executeRawUnsafe('DROP TRIGGER "User_fixture_failure" ON "User"');
    await db.$executeRawUnsafe('DROP FUNCTION reject_fixture_account()');
    const dry = await repairNewsletterUsers(db);
    assert.equal(dry.mode, 'dry-run'); assert.equal(await db.user.count(), 2);
    const repaired = await repairNewsletterUsers(db, true);
    assert.equal(repaired.after.confirmedWithoutAccount.length, 0); assert.equal(repaired.after.needsLink.length, 0);
    assert.equal((await repairNewsletterUsers(db, true)).processed, 0);
    assert.equal(await db.newsletterMailJob.count(), 0);
    const orphan = await db.user.findUnique({ where: { email: 'orphan@example.test' } });
    assert.equal(orphan.accountState, 'PRE_REGISTERED'); assert.equal(orphan.password, null);
    assert.equal((await db.user.findUnique({ where: { id: old.id } })).accountState, 'ACTIVE');
    assert.equal((await db.user.findUnique({ where: { id: other.id } })).accountState, 'PENDING_PASSWORD');
    await Promise.all(Array.from({ length: 6 }, (_, i) => service.subscribe(i % 2 ? '  NEW@Example.test ' : 'new@example.test')));
    const fresh = await db.user.findUnique({ where: { email: 'new@example.test' } });
    assert(fresh && fresh.memberCode); assert.equal(fresh.password, null); assert.equal(fresh.accountState, 'PRE_REGISTERED');
    assert.equal(await db.user.count({ where: { email: 'new@example.test' } }), 1);
    assert.equal(await db.newsletterMailJob.count({ where: { email: 'new@example.test', kind: 'WELCOME' } }), 1);
    assert.equal((await db.newsletterSubscription.findUnique({ where: { email: fresh.email } })).userId, fresh.id);
    const beforeActivation = await admin.listUsers({ page: 1, pageSize: 20 });
    assert.equal(beforeActivation.data.find(row => row.id === fresh.id).accountState, 'PRE_REGISTERED');
    await service.subscribe(' OLD@example.test ');
    assert.equal(await db.user.count({ where: { email: 'old@example.test' } }), 1);
    assert.equal((await db.user.findUnique({ where: { id: old.id } })).password, old.password);
    // The database itself rejects changes and reuse, including old printed QR tokens.
    await assert.rejects(() => db.user.update({ where: { id: old.id }, data: { memberCode: 'CRX-000001' } }));
    const codesBefore = await db.user.findMany({ select: { id: true, memberCode: true } });
    const token = await users.ensurePublicMemberToken(fresh.id);
    const qrTokens = await Promise.all([users.ensurePublicMemberToken(fresh.id), users.ensurePublicMemberToken(fresh.id)]);
    assert.deepEqual(qrTokens, [token, token]);
    const stable = fresh.memberCode;
    const activated = await users.activatePreRegisteredUser(fresh.id, { password: 'synthetic-hash', firstName: 'Fixture', lastName: 'User' });
    assert.equal(activated.memberCode, stable);
    const listed = await admin.listUsers({ page: 1, pageSize: 20 });
    const detail = await admin.getUserById(fresh.id);
    assert.equal(listed.data.find(row => row.id === fresh.id).memberCode, detail.user.memberCode);
    assert.equal(detail.user.memberCode, stable);
    assert.equal(listed.meta.total, await db.user.count());
    const filtered = await admin.listUsers({ q: stable }); assert.equal(filtered.meta.total, 1);
    const pendingList = await admin.listUsers({ accountState: 'PRE_REGISTERED' }); assert.equal(pendingList.meta.total, 1);
    const page = await admin.listUsers({ page: 2, pageSize: 2 }); assert.equal(page.meta.total, listed.meta.total);
    await db.user.delete({ where: { id: other.id } });
    await assert.rejects(() => db.user.create({ data: { id: other.id, email: 'recreated@example.test', memberCode: other.memberCode } }));
    await assert.rejects(() => db.user.create({ data: { email: 'reuse@example.test', memberCode: '000007' } }));
    const withoutCode = await db.user.create({ data: { email: 'direct@example.test' } }); assert(withoutCode.memberCode);
    const after = await db.user.findMany({ select: { id: true, memberCode: true } });
    for (const row of codesBefore.filter(row => row.id !== other.id)) assert.equal(after.find(a => a.id === row.id).memberCode, row.memberCode);
    assert.equal(new Set(after.map(row => row.memberCode)).size, after.length);
    await db.user.delete({ where: { id: old.id } });
    await assert.rejects(() => db.user.create({ data: { email: 'old-qr-reuse@example.test', publicMemberToken: 'previous-issued-token' } }));
    const { MembershipService } = require('../dist/membership/membership.service');
    const membership = new MembershipService(db, users, {}, {});
    assert.equal((await membership.getMemberInfo('previous-issued-token')).valid, false);
    const qr = await membership.getQrForUser(fresh.id);
    await fs.mkdir(out, { recursive: true }); await fs.writeFile(path.join(out, 'qr-fixture.png'), qr);
    await fs.writeFile(path.join(out, 'fixture.json'), JSON.stringify({ list: beforeActivation, detail, profile: { ...activated, password: undefined, hasPassword: true }, pending: { ...orphan, password: undefined } }, null, 2));
    await Promise.all(Array.from({ length: 4 }, (_, i) => service.subscribe(`distinct-${i}@example.test`)));
    const parallel = await db.user.findMany({ where: { email: { startsWith: 'distinct-' } }, select: { memberCode: true } });
    assert.equal(parallel.length, 4); assert.equal(new Set(parallel.map(row => row.memberCode)).size, 4);
    await assert.rejects(() => db.user.create({ data: { email: ' NEW@EXAMPLE.TEST ' } }));
    const report = { before, repaired, checks: ['real PostgreSQL migration', 'transactional concurrent newsletter creation', 'normalized account uniqueness', 'states and consent preserved', 'dry-run/no mail/idempotence', 'public ID table/detail/profile equality', 'activation stability', 'delete stability/no code or QR reuse', 'concurrent QR identity', 'filter/pagination/count agreement'], mailJobsCreatedOnlyBySubscribe: await db.newsletterMailJob.count() };
    await fs.writeFile(path.join(out, 'database-report.json'), JSON.stringify(report, null, 2));
    console.log('PASS: isolated PostgreSQL, identities, newsletter concurrency, repair and counts');
  } finally {
    if (db) await db.$disconnect();
    run(exe('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
