'use strict';
// Real PostgreSQL, real JWT sessions/guards, disposable loopback database only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto'), { spawnSync } = require('node:child_process');
const { Client, Pool } = require('pg');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const database = 'cronox_qr_test_' + randomUUID().replace(/-/g, '');
const checks = [];
const migrationPath = 'prisma/migrations/20261016160000_metacrilatos_qr_events/migration.sql';
const read = file => fs.readFileSync(path.join(backend, file), 'utf8');
async function main() {
  const local = loadLocalEnvironment(); ensureLocalPostgres(local);
  const source = new URL(local.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(source.hostname));
  source.search = '';
  const control = new Client({ connectionString: source.href });
  let created = false, sql, db, second, app, numberingPool;
  try {
    await control.connect();
    assert.ok(['127.0.0.1', '::1'].includes((await control.query('SELECT host(inet_server_addr()) AS host')).rows[0].host));
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + database;
    const env = { ...local, DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href };
    sql = new Client({ connectionString: target.href }); await sql.connect();
    await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    const setup = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'],
      { cwd: backend, env, encoding: 'utf8', windowsHide: true, timeout: 60000 });
    assert.equal(setup.status, 0, 'Disposable Prisma schema setup failed: ' + setup.stderr);
    Object.assign(process.env, env);
    require('../test/test-environment.cjs').installTestEnvironment({ force: true, overrides: env });
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    const { UsersService } = require('../src/users/users.service');
    const { CircleService } = require('../src/membership/circle.service');
    const { MembershipService } = require('../src/membership/membership.service');
    const { QrEventsService } = require('../src/admin/qr-events/qr-events.service');
    const { AccreditationsService } = require('../src/accreditations/accreditations.service');
    const { AuthSessionsService } = require('../src/auth/auth-sessions.service');
    db = new PrismaService(); second = new PrismaService(); await db.$connect(); await second.$connect();
    assert.equal((await db.$queryRawUnsafe('SELECT current_database() name'))[0].name, database);
    // Install the actual identity, compaction and deletion functions over the
    // disposable schema. Existing migration history is never altered.
    const identity = read('prisma/migrations/20261008190000_consecutive_user_numbers/migration.sql');
    const retire = read('prisma/migrations/20261009020000_retired_user_references/migration.sql');
    const deletion = read('prisma/migrations/20261009023000_deleted_account_order_history/migration.sql');
    await sql.query(identity.slice(identity.indexOf('CREATE FUNCTION cronox_user_number_code'), identity.indexOf('CREATE FUNCTION cronox_compact_users')));
    await sql.query(retire.slice(retire.indexOf('CREATE FUNCTION cronox_user_reference_key'), retire.indexOf('CREATE FUNCTION cronox_retire_user_references')));
    await sql.query(retire.slice(retire.indexOf('CREATE OR REPLACE FUNCTION cronox_compact_users'), retire.lastIndexOf('COMMIT;')));
    await sql.query(deletion.slice(deletion.indexOf('CREATE OR REPLACE FUNCTION cronox_retire_user_references'), deletion.lastIndexOf('COMMIT;')));
    await sql.query(identity.slice(identity.indexOf('CREATE FUNCTION cronox_number_user()'), identity.indexOf('DROP TRIGGER "User_check_reserved_id"')));
    for (const definition of [
      '"User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user()',
      '"User_retire_references" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_retire_user_references()',
      '"User_delete_gate" BEFORE DELETE ON "User" FOR EACH STATEMENT EXECUTE FUNCTION cronox_lock_user_deletion()',
      '"User_compact_deleted" AFTER DELETE ON "User" FOR EACH STATEMENT EXECUTE FUNCTION cronox_compact_after_user_delete()',
    ]) await sql.query('CREATE TRIGGER ' + definition);
    await db.userNumberingState.create({ data: { id: 1, nextId: 1, ready: true } });
    const older = await db.user.create({ data: { email: 'delete-first@qr.test' } });
    const admin = await db.user.create({ data: { email: 'admin@qr.test', role: 'ADMIN', firstName: 'Admin Uno' } });
    const superadmin = await db.user.create({ data: { email: 'super@qr.test', role: 'SUPERADMIN', firstName: 'Admin Dos' } });
    const person = await db.user.create({ data: { email: 'person@qr.test', firstName: '  Daniel   Rivas Cruz ', circleLevel: 3, publicMemberToken: null } });
    const other = await db.user.create({ data: { email: 'other@qr.test', firstName: null, circleLevel: 4 } });
    const friend = await db.user.create({ data: { email: 'friend@qr.test', role: 'FRIEND' } });
    await db.accreditationDesign.create({ data: { id: 'original', renderer: 'original-v1', name: 'Mi acreditación', config: { version: 1, artworkUrl: '/assets/logo_banner.png' } } });
    await db.accreditationSelection.create({ data: { id: 'global', activeDesignId: 'original', revision: 19 } });
    const originalBefore = await db.accreditationDesign.findUnique({ where: { id: 'original' } });
    const selectionBefore = await db.accreditationSelection.findUnique({ where: { id: 'global' } });
    await sql.query('DROP TABLE "QrEventParticipant"; DROP TABLE "QrEventGroup"; ALTER TABLE "User" ALTER COLUMN "publicMemberToken" DROP DEFAULT');
    await sql.query(read(migrationPath));
    const backfilled = await db.user.findUniqueOrThrow({ where: { id: person.id } });
    assert.match(backfilled.publicMemberToken, /^[a-f0-9]{32}$/);
    const migration = read(migrationPath);
    // Repeat the provisioning portion, the same operation used by migration.
    await sql.query(migration.slice(migration.indexOf('INSERT INTO'), migration.indexOf('CREATE TABLE')));
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: person.id } })).publicMemberToken, backfilled.publicMemberToken);
    assert.equal(await db.accreditationDesign.count({ where: { id: 'metacrilatos' } }), 1);
    assert.deepEqual(await db.accreditationSelection.findUnique({ where: { id: 'global' } }), selectionBefore);
    assert.deepEqual(await db.accreditationDesign.findUnique({ where: { id: 'original' } }), originalBefore);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: other.id } })).publicMemberToken, other.publicMemberToken);
    checks.push('Additive migration + repeated provisioning preserve original design/selection/existing tokens; new and historical users have distinct persistent tokens');
    const users = new UsersService(db), circles = new CircleService(db, {});
    const membership = new MembershipService(db, users, {}, circles);
    const service = new QrEventsService(db, circles), service2 = new QrEventsService(second, new CircleService(second, {}));
    const card = await membership.getMyAccreditation(person.id);
    assert.equal(card.name, 'Daniel Rivas'); assert.equal(card.visibleId, person.identityUid);
    assert.equal(card.createdAt.toISOString(), person.createdAt.toISOString());
    assert.equal((await membership.getMyAccreditation(other.id)).name, '');
    await db.user.update({ where: { id: person.id }, data: { firstName: 'Un nombre distinto', circleLevel: 5 } });
    assert.equal((await membership.getMyAccreditation(person.id)).qrPayload, card.qrPayload);
    assert.notEqual((await membership.getMyAccreditation(other.id)).qrPayload, card.qrPayload);
    assert.equal(new Set(await Promise.all(Array.from({ length: 12 }, () => users.ensurePublicMemberToken(person.id)))).size, 1);
    const lazy = await db.user.create({ data: { email: 'legacy-null@qr.test', publicMemberToken: null } });
    assert.equal(new Set(await Promise.all(Array.from({ length: 12 }, () => users.ensurePublicMemberToken(lazy.id)))).size, 1);
    await assert.rejects(db.user.update({ where: { id: person.id }, data: { publicMemberToken: randomUUID() } }));
    checks.push('Real identity triggers + concurrent provisioning preserve QR through reload/name/circle changes; firstName-only mapping and original registration/UUID verified');
    const group = await service.create({ name: 'Encuentro local', description: 'Prueba aislada' }, admin.id);
    const group2 = await service.create({ name: 'Otro encuentro' }, superadmin.id);
    const race = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? service2 : service).scan(group.id, card.qrPayload, index % 2 ? superadmin.id : admin.id)));
    assert.equal(race.filter(r => r.status === 'registered').length, 1);
    assert.equal(race.filter(r => r.status === 'already_registered').length, 11);
    assert.equal(await db.qrEventParticipant.count({ where: { groupId: group.id } }), 1);
    const first = race.find(r => r.status === 'registered');
    const retry = await service2.scan(group.id, card.qrPayload, superadmin.id);
    assert.equal(retry.status, 'already_registered'); assert.deepEqual(retry.participant, first.participant);
    assert.equal((await service2.scan(group2.id, card.qrPayload, superadmin.id)).status, 'registered');
    assert.equal((await service2.participants(group.id, {})).group.total, 1);
    assert.equal((await service2.participants(group.id, {})).items[0].circleAtRegistration, 5);
    await assert.rejects(service.scan(group.id, 'CRX:1:' + 'x'.repeat(32), admin.id), error => error.getResponse().code === 'INVALID_QR');
    await assert.rejects(service.scan(randomUUID(), card.qrPayload, admin.id), error => error.getResponse().code === 'GROUP_UNAVAILABLE');
    await db.user.update({ where: { id: person.id }, data: { accountState: 'INACTIVE' } });
    await assert.rejects(service.scan(group.id, card.qrPayload, admin.id), error => error.getResponse().code === 'CREDENTIAL_UNUSABLE');
    await db.user.update({ where: { id: person.id }, data: { accountState: 'ACTIVE', circleLevel: 0 } });
    await assert.rejects(service.scan(group.id, card.qrPayload, admin.id), error => error.getResponse().code === 'CREDENTIAL_UNUSABLE');
    await db.user.update({ where: { id: person.id }, data: { circleLevel: 3 } });
    await assert.rejects(db.qrEventGroup.delete({ where: { id: group.id } }));
    checks.push('12 simultaneous scans on two independent PostgreSQL clients produce exactly one row; retry preserves first time/actor/circle; separate group succeeds; unavailable/inactive/invalid reject');

    const { Test } = require('@nestjs/testing');
    const { ValidationPipe } = require('@nestjs/common');
    const { PassportModule } = require('@nestjs/passport');
    const { JwtAccessStrategy } = require('../src/auth/strategies/jwt-access.strategy');
    const { AdminGuard } = require('../src/common/guards/admin.guard');
    const { RolesGuard } = require('../src/common/guards/roles.guard');
    const { CsrfProtectionGuard } = require('../src/common/guards/csrf-protection.guard');
    const { QrEventsController } = require('../src/admin/qr-events/qr-events.controller');
    const { MembershipController } = require('../src/membership/membership.controller');
    const { AdminAccreditationsController } = require('../src/accreditations/accreditations.controller');
    const sessions = new AuthSessionsService(db);
    const accreditations = new AccreditationsService(db);
    const module = await Test.createTestingModule({ imports: [PassportModule], controllers: [QrEventsController, MembershipController, AdminAccreditationsController],
      providers: [AdminGuard, RolesGuard, JwtAccessStrategy,
        { provide: AuthSessionsService, useValue: sessions }, { provide: UsersService, useValue: users },
        { provide: QrEventsService, useValue: service }, { provide: MembershipService, useValue: membership },
        { provide: AccreditationsService, useValue: accreditations }] }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api'); app.use(require('cookie-parser')());
    const { userNumberingMiddleware, UserNumberingCompletion } = require('../src/users/user-numbering.middleware');
    numberingPool = new Pool({ connectionString: target.href, max: 8 });
    app.use(userNumberingMiddleware(numberingPool));
    app.useGlobalInterceptors(new UserNumberingCompletion());
    app.useGlobalGuards(new CsrfProtectionGuard());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init(); const request = require('supertest')(app.getHttpServer());
    const tokens = {};
    for (const user of [admin, superadmin, person, friend]) tokens[user.role] = (await sessions.create(await db.user.findUniqueOrThrow({ where: { id: user.id } }))).accessToken;
    const auth = role => ({ Authorization: 'Bearer ' + tokens[role] });
    const csrf = { Origin: env.FRONTEND_URL, Cookie: 'cronox_csrf_token=qr-test', 'X-CSRF-Token': 'qr-test' };
    for (const route of ['', '/' + group.id, '/' + group.id + '/participants']) {
      await request.get('/api/admin/qr-events' + route).expect(401);
      for (const role of ['USER', 'FRIEND']) await request.get('/api/admin/qr-events' + route).set(auth(role)).expect(403);
      for (const role of ['ADMIN', 'SUPERADMIN']) await request.get('/api/admin/qr-events' + route).set(auth(role)).expect(200);
    }
    for (const role of ['USER', 'FRIEND']) {
      await request.post('/api/admin/qr-events').set({ ...auth(role), ...csrf }).send({ name: 'Forbidden' }).expect(403);
      await request.post(`/api/admin/qr-events/${group.id}/scan`).set({ ...auth(role), ...csrf }).send({ qrContent: card.qrPayload }).expect(403);
    }
    await request.post('/api/admin/qr-events').set(auth('ADMIN')).send({ name: 'No CSRF' }).expect(403);
    await request.post('/api/admin/qr-events').set({ ...auth('ADMIN'), ...csrf }).send({ name: '   ' }).expect(400);
    await request.post('/api/admin/qr-events').set({ ...auth('SUPERADMIN'), ...csrf }).send({ name: 'Creado por HTTP' }).expect(201);
    await request.get('/api/admin/qr-events?limit=1000').set(auth('ADMIN')).expect(400);
    const before = await db.qrEventParticipant.count();
    for (const qrContent of ['www.cronox.es', 'https://evil.test/api/m/' + backfilled.publicMemberToken, 'CRX:PREVIEW:INVALID', 'CRX:1:' + 'z'.repeat(32)]) {
      const result = await request.post(`/api/admin/qr-events/${group.id}/scan`).set({ ...auth('ADMIN'), ...csrf }).send({ qrContent }).expect(400);
      assert.equal(result.body.code, 'INVALID_QR'); assert.ok(!JSON.stringify(result.body).includes(person.email));
    }
    await request.post(`/api/admin/qr-events/${group.id}/scan`).set({ ...auth('ADMIN'), ...csrf }).send({ qrContent: card.qrPayload, userId: other.id, circleLevel: 5 }).expect(400);
    assert.equal(await db.qrEventParticipant.count(), before);
    const own = await request.get('/api/membership/me/accreditation?userId=' + other.id).set(auth('USER')).expect(200);
    assert.equal(own.body.visibleId, person.identityUid); assert.equal(own.body.qrPayload, card.qrPayload);
    assert.match(own.headers['cache-control'], /no-store/);
    let enterCard, releaseCard;
    const entered = new Promise(resolve => { enterCard = resolve; });
    const released = new Promise(resolve => { releaseCard = resolve; });
    const getCard = membership.getMyAccreditation.bind(membership);
    membership.getMyAccreditation = async id => { enterCard(); await released; return getCard(id); };
    const inFlight = request.get('/api/membership/me/accreditation').set(auth('USER')).then(response => response);
    await entered;
    await sql.query('BEGIN'); await sql.query("SET LOCAL lock_timeout='150ms'");
    await assert.rejects(sql.query('SELECT pg_advisory_xact_lock(824031,1)'), error => error.code === '55P03');
    await sql.query('ROLLBACK'); releaseCard(); assert.equal((await inFlight).status, 200);
    membership.getMyAccreditation = getCard;
    checks.push('Real HTTP numbering middleware prevents controlled deletion/renumbering during the authenticated own-card request; IDs cannot change owner between auth and rendering');
    await request.get('/api/membership/me/accreditation').expect(401);
    await db.authSession.updateMany({ where: { userId: person.id }, data: { revokedAt: new Date() } });
    await request.get('/api/membership/me/accreditation').set(auth('USER')).expect(401);
    checks.push('Real signed JWT + DB sessions, ADMIN/SUPERADMIN guards, CSRF, DTO bounds, forged user/circle rejection, own-only private card and revoked-session denial pass through HTTP');
    const previewBefore = { users: await db.user.count(), participants: await db.qrEventParticipant.count(),
      audit: await db.auditLog.count(), designs: await db.accreditationDesign.findMany({ orderBy: { id: 'asc' } }) };
    const previewData = await request.get('/api/admin/accreditations/metacrilatos/preview-data').set(auth('ADMIN')).expect(200);
    assert.equal(previewData.body.renderer, 'metacrilatos-v1'); assert.match(previewData.body.sampleQr, /^data:image\/png;base64,/);
    assert.deepEqual(await db.accreditationSelection.findUnique({ where: { id: 'global' } }), selectionBefore);
    assert.deepEqual({ users: await db.user.count(), participants: await db.qrEventParticipant.count(),
      audit: await db.auditLog.count(), designs: await db.accreditationDesign.findMany({ orderBy: { id: 'asc' } }) }, previewBefore);
    const beforeActivation = await request.get('/api/admin/accreditations').set(auth('ADMIN')).expect(200);
    await request.post('/api/admin/accreditations/metacrilatos/activate').set(auth('ADMIN'))
      .send({ expectedRevision: beforeActivation.body.revision }).expect(403);
    const activation = await request.post('/api/admin/accreditations/metacrilatos/activate').set({ ...auth('ADMIN'), ...csrf })
      .send({ expectedRevision: beforeActivation.body.revision }).expect(201);
    assert.equal((await accreditations.active()).id, 'metacrilatos');
    assert.equal(activation.body.designs.find(design => design.id === 'metacrilatos').active, true);
    await request.post('/api/admin/accreditations/original/activate').set({ ...auth('SUPERADMIN'), ...csrf })
      .send({ expectedRevision: activation.body.revision }).expect(201);
    assert.equal((await accreditations.active()).id, 'original');
    assert.deepEqual(await db.accreditationDesign.findUnique({ where: { id: 'original' } }), originalBefore);
    checks.push('Real authenticated HTTP preview-data writes no users, participants, audit, design or selection; POST activation checks CSRF/revision, activates METACRILATOS as ADMIN and restores original as SUPERADMIN without changing its artwork/configuration');

    const { ownership } = require('./user-numbering-ownership.cjs');
    const ownershipBefore = await ownership(sql);
    assert.ok(ownershipBefore.records.some(record => record.includes('QrEventParticipant') && record.includes(person.identityUid)));
    // Use real controlled-deletion gate + compaction trigger in disposable DB.
    await sql.query('BEGIN'); await sql.query('SELECT pg_advisory_xact_lock(824031,1)');
    await sql.query("SELECT set_config('cronox.user_delete','on',true)");
    await sql.query('DELETE FROM "User" WHERE "identityUid"=$1', [older.identityUid]); await sql.query('COMMIT');
    const afterRenumber = await db.user.findUniqueOrThrow({ where: { identityUid: person.identityUid } });
    assert.notEqual(afterRenumber.id, person.id); assert.notEqual(afterRenumber.memberCode, person.memberCode);
    assert.equal((await membership.getMyAccreditation(afterRenumber.id)).qrPayload, card.qrPayload);
    const recordsAfter = (await ownership(sql)).records;
    assert.deepEqual(recordsAfter, ownershipBefore.records.filter(record => !record.includes(older.identityUid)));
    assert.equal((await service.participants(group.id, {})).items[0].publicUserId, person.identityUid);
    await sql.query('BEGIN'); await sql.query('SELECT pg_advisory_xact_lock(824031,1)');
    await sql.query("SELECT set_config('cronox.user_delete','on',true)");
    await sql.query('DELETE FROM "User" WHERE "identityUid"=$1', [person.identityUid]); await sql.query('COMMIT');
    const retired = (await service.participants(group.id, {})).items[0];
    assert.equal(retired.deleted, true); assert.equal(retired.name, ''); assert.equal(retired.publicUserId, null); assert.equal(retired.qrIdentifier, null);
    assert.equal(retired.registeredAt.toISOString(), first.participant.registeredAt.toISOString());
    assert.equal((await service.get(group.id)).total, 1);
    const currentAdmin = await db.user.findUniqueOrThrow({ where: { identityUid: admin.identityUid } });
    await assert.rejects(service.scan(group.id, card.qrPayload, currentAdmin.id), error => error.getResponse().code === 'INVALID_QR');
    await assert.rejects(db.user.create({ data: { email: 'reuse@qr.test', publicMemberToken: backfilled.publicMemberToken } }));
    checks.push('Actual controlled deletion + renumbering preserve UUID attribution and QR; deleting attendee keeps anonymous event count/time/circle, removes PII, rejects retired QR and token reuse');
  } finally {
    if (app) await app.close(); if (numberingPool) await numberingPool.end(); if (db) await db.$disconnect(); if (second) await second.$disconnect(); if (sql) await sql.end();
    if (created) { assert.match(database, /^cronox_qr_test_[a-f0-9]{32}$/); await control.query(`DROP DATABASE "${database}" WITH (FORCE)`); }
    await control.end();
  }
  const report = { passed: true, database: 'disposable loopback PostgreSQL', cleanedUp: true, checks };
  const directory = path.resolve(backend, '../output/metacrilatos'); fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'backend-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(String(error.stack || error).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]')); process.exitCode = 1; });
