'use strict';
// Disposable loopback database only. The second design exists only in this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
const backend = path.resolve(__dirname, '..');
const database = `cronox_accreditation_test_${randomUUID().replace(/-/g, '')}`;

async function main() {
  const environment = loadLocalEnvironment();
  const source = new URL(environment.DATABASE_URL);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(source.hostname));
  source.search = '';
  const control = new Client({ connectionString: source.href, connectionTimeoutMillis: 5000 });
  let created = false, prisma, app;
  try {
    await control.connect();
    await control.query(`CREATE DATABASE "${database}" TEMPLATE template0`); created = true;
    const target = new URL(source); target.pathname = '/' + database;
    const env = { ...environment, DATABASE_URL: target.href, DIRECT_URL: target.href, USER_NUMBERING_DATABASE_URL: target.href };
    const sql = new Client({ connectionString: target.href });
    await sql.connect();
    try { await sql.query('CREATE EXTENSION IF NOT EXISTS pg_trgm'); } finally { await sql.end(); }
    const setup = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'],
      { cwd: backend, env, windowsHide: true, encoding: 'utf8', timeout: 60000 });
    assert.equal(setup.status, 0, 'Disposable schema setup failed');
    Object.assign(process.env, env);
    require('ts-node').register({ project: path.join(backend, 'tsconfig.json'), transpileOnly: true });
    const { PrismaService } = require('../src/prisma/prisma.service');
    prisma = new PrismaService(); await prisma.$connect();
    const admin = await prisma.user.create({ data: { email: 'admin@accreditation.test', role: 'ADMIN' } });
    const person = await prisma.user.create({ data: { email: 'person@accreditation.test', publicMemberToken: randomUUID() } });
    const peopleBefore = await prisma.user.findMany({ orderBy: { id: 'asc' } });
    await prisma.$executeRawUnsafe('DROP TABLE "AccreditationSelection"');
    await prisma.$executeRawUnsafe('DROP TABLE "AccreditationDesign"');
    const migration = new Client({ connectionString: target.href });
    await migration.connect();
    try { await migration.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261016120000_accreditation_designs/migration.sql'), 'utf8')); }
    finally { await migration.end(); }
    const registry = require('../src/accreditations/design-registry');
    const originalDefinition = registry.DESIGN_REGISTRY.original;
    registry.DESIGN_REGISTRY = Object.freeze({ ...registry.DESIGN_REGISTRY,
      'test-only': { ...originalDefinition, renderer: 'test-only-v1' } });
    const { AccreditationsService } = require('../src/accreditations/accreditations.service');
    let service = new AccreditationsService(prisma);
    assert.equal((await service.active()).id, 'original');
    assert.equal((await service.list()).designs[0].name, 'Acreditación original');
    const original = await service.preview('original');
    const profile = fs.readFileSync(path.resolve(backend, '../cronox-front/profile.html'), 'utf8');
    assert.ok(profile.includes(`src="${original.config.artworkUrl}"`), 'Migration must preserve the existing artwork');
    assert.equal(original.config.artworkUrl, registry.ORIGINAL_ARTWORK);
    // Use a real bundled image for resource validation without external requests.
    await service.update('original', { name: original.name, expectedRevision: 0,
      config: { version: 1, artworkUrl: '/assets/logo_banner.png' } }, admin.id);
    const savedOriginal = await service.preview('original');
    const unchangedState = await service.list();
    const unchangedAudit = await prisma.auditLog.count();
    await service.update('original', { name: savedOriginal.name, expectedRevision: savedOriginal.revision,
      config: { ...savedOriginal.config } }, admin.id);
    assert.deepEqual(await service.list(), unchangedState, 'An unchanged save must not touch configuration, timestamps or revisions');
    assert.equal(await prisma.auditLog.count(), unchangedAudit, 'An unchanged save must not create an audit write');
    await assert.rejects(service.update('original', { name: savedOriginal.name, expectedRevision: 0,
      config: { ...savedOriginal.config } }, admin.id));
    // Prisma normally skips applied migrations. Even an accidental SQL replay
    // must fail atomically, never replace an existing customized configuration.
    const replay = new Client({ connectionString: target.href });
    await replay.connect();
    try {
      await assert.rejects(replay.query(fs.readFileSync(path.join(backend, 'prisma/migrations/20261016120000_accreditation_designs/migration.sql'), 'utf8')));
      await replay.query('ROLLBACK');
    } finally { await replay.end(); }
    assert.deepEqual(await service.list(), unchangedState, 'Initialization cannot overwrite existing designs');
    await prisma.accreditationDesign.create({ data: { id: 'test-only', name: 'Test only', renderer: 'test-only-v1',
      config: { version: 1, artworkUrl: '/assets/logo_banner.png' } } });
    let before = await service.list();
    await service.preview('test-only');
    assert.deepEqual(await service.list(), before, 'Preview must not write');
    await service.activate('test-only', before.revision, admin.id);
    await prisma.$disconnect();
    prisma = new PrismaService(); await prisma.$connect(); service = new AccreditationsService(prisma);
    assert.equal((await service.active()).id, 'test-only', 'Selection persists across new connections/service instances');
    await service.activate('original', (await service.list()).revision, admin.id);
    assert.equal((await service.active()).id, 'original');
    assert.deepEqual(await service.preview('original'), savedOriginal);
    assert.equal((await service.preview('test-only')).config.artworkUrl, '/assets/logo_banner.png');
    before = await service.list();
    await assert.rejects(service.activate('missing', before.revision, admin.id));
    await prisma.accreditationDesign.create({ data: { id: 'unfinished', name: 'Unfinished', renderer: 'absent', config: {} } });
    await assert.rejects(service.activate('unfinished', before.revision, admin.id));
    await assert.rejects(service.update('original', { name: 'Bad', expectedRevision: 1, config: { version: 1, artworkUrl: 'javascript:alert(1)' } }, admin.id));
    await assert.rejects(service.update('original', { name: 'Bad', expectedRevision: 1, config: { version: 1, artworkUrl: '/assets/missing-accreditation.png' } }, admin.id));
    assert.equal((await service.active()).id, 'original');
    // A failing audit write must roll back the selection update too.
    await assert.rejects(service.activate('test-only', before.revision, 2147483647));
    assert.equal((await service.list()).revision, before.revision);
    const race = await Promise.allSettled([
      service.activate('test-only', before.revision, admin.id),
      service.activate('original', before.revision, admin.id),
    ]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await service.list()).designs.filter(design => design.active).length, 1);
    await service.activate('original', (await service.list()).revision, admin.id);
    assert.deepEqual(await prisma.user.findMany({ orderBy: { id: 'asc' } }), peopleBefore);
    assert.equal((await prisma.user.findUnique({ where: { id: person.id } })).publicMemberToken, person.publicMemberToken);
    await assert.rejects(prisma.$executeRawUnsafe(`INSERT INTO "AccreditationSelection" ("id", "activeDesignId") VALUES ('other', 'original')`));
    await assert.rejects(prisma.accreditationDesign.delete({ where: { id: 'original' } }));
    console.log('PASS migration, preserved identities, preview isolation, switch/back, persistence, rollback, resource validation, concurrent activation, DB constraints');

    const { Test } = require('@nestjs/testing');
    const { ValidationPipe, UnauthorizedException } = require('@nestjs/common');
    const { JwtAuthGuard } = require('../src/auth/guards/jwt-auth.guard');
    const { AdminGuard } = require('../src/common/guards/admin.guard');
    const { RolesGuard } = require('../src/common/guards/roles.guard');
    const { CsrfProtectionGuard } = require('../src/common/guards/csrf-protection.guard');
    const { AccreditationsController, AdminAccreditationsController } = require('../src/accreditations/accreditations.controller');
    const module = await Test.createTestingModule({ controllers: [AccreditationsController, AdminAccreditationsController],
      providers: [AdminGuard, RolesGuard, { provide: AccreditationsService, useValue: service }] })
      .overrideGuard(JwtAuthGuard).useValue({ canActivate(context) {
        const req = context.switchToHttp().getRequest();
        if (!req.headers['x-test-role']) throw new UnauthorizedException();
        req.user = { id: admin.id, role: req.headers['x-test-role'] }; return true;
      } }).compile();
    app = module.createNestApplication(); app.setGlobalPrefix('api');
    app.use(require('cookie-parser')());
    app.use((req, res, next) => { res.setHeader('Content-Security-Policy', "frame-ancestors 'none'"); next(); });
    app.useGlobalGuards(new CsrfProtectionGuard());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    const request = require('supertest')(app.getHttpServer());
    const csrf = { Origin: environment.FRONTEND_URL, Cookie: 'cronox_csrf_token=accreditation-test', 'X-CSRF-Token': 'accreditation-test' };
    const routes = ['', '/original/preview', '/original/preview-data'];
    for (const route of routes) {
      await request.get('/api/admin/accreditations' + route).expect(401);
      for (const role of ['USER', 'FRIEND']) await request.get('/api/admin/accreditations' + route).set('x-test-role', role).expect(403);
      for (const role of ['ADMIN', 'SUPERADMIN']) await request.get('/api/admin/accreditations' + route).set('x-test-role', role).expect(200);
    }
    before = await service.list();
    const page = await request.get('/api/admin/accreditations/original/preview').set('x-test-role', 'ADMIN').expect(200);
    assert.match(page.headers['cache-control'], /no-store/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.ok(!page.text.includes('assets/profile.js'));
    assert.ok(page.text.includes('assets/accreditation-preview.js'));
    assert.deepEqual(await service.list(), before);
    await request.post('/api/admin/accreditations/test-only/activate').set('x-test-role', 'ADMIN').send({ expectedRevision: before.revision }).expect(403);
    for (const role of ['USER', 'FRIEND']) {
      await request.post('/api/admin/accreditations/test-only/activate').set(csrf).set('x-test-role', role).send({ expectedRevision: before.revision }).expect(403);
      await request.patch('/api/admin/accreditations/original').set(csrf).set('x-test-role', role).send({}).expect(403);
    }
    await request.post('/api/admin/accreditations/test-only/activate').set(csrf).set('x-test-role', 'ADMIN').send({ expectedRevision: -1 }).expect(400);
    await request.post('/api/admin/accreditations/missing/activate').set(csrf).set('x-test-role', 'ADMIN').send({ expectedRevision: before.revision }).expect(404);
    await request.post('/api/admin/accreditations/test-only/activate').set(csrf).set('x-test-role', 'ADMIN').send({ expectedRevision: before.revision }).expect(201);
    await request.post('/api/admin/accreditations/original/activate').set(csrf).set('x-test-role', 'SUPERADMIN').send({ expectedRevision: before.revision }).expect(409);
    await request.get('/api/accreditations/active').expect(200).expect(res => assert.equal(res.body.id, 'test-only'));
    console.log('PASS HTTP admin roles, protected preview, no preview writes, CSRF, validation, stale revision and public selection');
  } finally {
    await app?.close(); await prisma?.$disconnect();
    if (created) await control.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await control.end();
  }
}
main().catch(error => { console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
