/* Isolated PostgreSQL + simulated IMAP + real loopback SMTP/TLS + Nest HTTP checks.
 * Never reads .env, never connects Hostinger, never touches real messages/users.
 * node cronox-backend/scripts/review-mailbox.cjs [--serve]
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
    process.env.MAILBOX_TEST_PG_BIN ||
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
      path.join(os.tmpdir(), 'cronox-mailbox-review-'),
    ),
    dbDir = path.join(dir, 'pg');
  const probe = net.createServer();
  await new Promise((r) => probe.listen(0, '127.0.0.1', r));
  const port = probe.address().port;
  await new Promise((r) => probe.close(r));
  const url = `postgresql://mailbox_review@127.0.0.1:${port}/postgres`;
  assert.equal(new URL(url).hostname, '127.0.0.1');
  run(exe('initdb'), [
    '-D',
    dbDir,
    '-U',
    'mailbox_review',
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
    const schema = (
      await fs.readFile(path.join(backend, 'prisma/schema.prisma'), 'utf8')
    ).replace(/model (?:Mailbox\w*|CampaignTemplateFamily|DailyVisitorBrowser|DailyVisitorLink) \{[\s\S]*?\n\}/g, '')
      .replace(/^.*(?:familyId String\?|campaignCircle Int\?|textOverride String\?|family CampaignTemplateFamily\?|@@unique\(\[familyId, campaignCircle\]\)).*\r?\n/gm,'')
      .replace(/^.*(?:deduplicationStartedAt|browserLinks DailyVisitorLink|disposition String|observedRole String).*\r?\n/gm,'');
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
    sql(
      path.join(
        backend,
        'prisma/migrations/20261002120000_permanent_visitor_finance_history/migration.sql',
      ),
    );
    sql(
      path.join(
        backend,
        'prisma/migrations/20261002160000_admin_mailboxes/migration.sql',
      ),
    );
    sql(path.join(backend,'prisma/migrations/20261003100000_mailbox_circle_campaigns/migration.sql'));
    sql(path.join(backend,'prisma/migrations/20261003120000_admin_push_events/migration.sql'));
    sql(path.join(backend,'prisma/migrations/20261003123000_admin_push_payment_utc/migration.sql'));
    sql(path.join(backend,'prisma/migrations/20261003130000_admin_push_manual_paid/migration.sql'));
    sql(path.join(backend,'prisma/migrations/20261002200000_visitor_daily_reconciliation/migration.sql'));
    const familyBefore = path.join(dir,'family-before.sql');
    await fs.writeFile(familyBefore, `
      INSERT INTO "EmailSenderProfile" (key,"updatedAt") VALUES ('INFO',now());
      INSERT INTO "EmailTemplateFolder" (id,"senderKey",name,"updatedAt") VALUES ('before-family-folder','INFO','Renamed private fixture folder',now());
      INSERT INTO "ManagedEmailTemplate" (id,"senderKey","folderId","importKey",name,purpose,subject,document,html,text,revision,"updatedAt")
      VALUES ('before-family-template','INFO','before-family-folder','INFO:3:RESTOCK','Renamed independent version','RESTOCK','Original subject','{"blocks":[{"type":"text","text":"Original content"}]}','<p>Original HTML</p>','Original plain text',7,now());
      INSERT INTO "ManagedEmailTemplate" (id,"senderKey","folderId","importKey",name,purpose,subject,document,html,text,revision,"updatedAt")
      VALUES ('before-transactional-template','INFO','before-family-folder','INFO:3:NEWSLETTER_WELCOME','Renamed independent version','NEWSLETTER_WELCOME','Transactional subject','{"blocks":[]}','<p>Transactional HTML</p>','Transactional plain text',4,now());
    `);
    sql(familyBefore);
    sql(path.join(backend,'prisma/migrations/20261003170000_mailbox_template_families/migration.sql'));
    const nameBefore = path.join(dir,'campaign-name-before.sql');
    await fs.writeFile(nameBefore, `
      INSERT INTO "Mailbox" (id,name,address,"fromName",provider,"imapHost","smtpHost",username,"updatedAt")
      VALUES ('name-migration-box','Synthetic legacy','name-migration@example.test','CRONOX','hostinger','imap.hostinger.com','smtp.hostinger.com','name-migration@example.test',now());
      INSERT INTO "MailboxDraft" (id,"mailboxId","userId",mode,subject,text,revision,status,"updatedAt")
      VALUES ('name-migration-draft','name-migration-box',1,'campaign','Existing customer subject','Existing content',7,'DRAFT',now());
    `);
    sql(nameBefore);
    sql(path.join(backend,'prisma/migrations/20261004130000_campaign_internal_name/migration.sql'));
    const nameAfter = path.join(dir,'campaign-name-after.sql');
    await fs.writeFile(nameAfter, `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM "MailboxDraft" WHERE id='name-migration-draft' AND "campaignName" IS NULL
          AND subject='Existing customer subject' AND text='Existing content' AND revision=7 AND status='DRAFT')
        THEN RAISE EXCEPTION 'Campaign name migration changed legacy data'; END IF;
      END $$;
      DELETE FROM "Mailbox" WHERE id='name-migration-box';
    `);
    sql(nameAfter);
    pass('Optional campaign name migration preserves existing subject, content, revision and state without backfilling');
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
        FRONTEND_URL: 'http://127.0.0.1:43121',
        API_PUBLIC_URL: 'http://127.0.0.1:43121',
        CORS_ORIGINS: 'http://127.0.0.1:43121',
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
              '<head><meta name="cronox:api-base" content="http://127.0.0.1:43121">',
            ),
          );
      } else next();
    });
    const get = (name) =>
      app.get(
        require(path.join(backend, 'dist/mailbox/' + name + '.service'))[
          name
            .split('-')
            .map((v) => v[0].toUpperCase() + v.slice(1))
            .join('') + 'Service'
        ],
      );
    const service = get('mailbox'),
      reader = get('mailbox-reader'),
      sync = get('mailbox-sync'),
      sender = get('mailbox-sender'),
      push = get('mailbox-push'),
      provider = get('mailbox-provider'),
      leases = get('mailbox-leases');
    const { MockImapStore } = require(
        path.join(root, 'tests/mailbox/mock-imap.cjs'),
      ),
      stores = new Map();
    provider.imap = async (box) => stores.get(box.id).client();
    const openssl =
      process.env.MAILBOX_TEST_OPENSSL ||
      (process.platform === 'win32'
        ? 'C:/Program Files/Git/usr/bin/openssl.exe'
        : 'openssl');
    run(openssl, [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      path.join(dir, 'key.pem'),
      '-out',
      path.join(dir, 'cert.pem'),
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost',
    ]);
    const cert = await fs.readFile(path.join(dir, 'cert.pem')),
      key = await fs.readFile(path.join(dir, 'key.pem'));
    let smtpMode = 'accept',
      smtpMessages = [];
    const { SMTPServer } = require('smtp-server');
    smtp = new SMTPServer({
      secure: true,
      key,
      cert,
      logger: false,
      onAuth(auth, _session, cb) {
        cb(
          auth.username === 'local-mail' &&
            auth.password === 'synthetic-password-only'
            ? null
            : Error('auth failed'),
          { user: 'local-mail' },
        );
      },
      onData(stream, _session, cb) {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => {
          if (smtpMode === 'reject')
            return cb(
              Object.assign(Error('synthetic rejection'), {
                responseCode: 550,
              }),
            );
          if (smtpMode === 'uncertain') {
            for (const connection of smtp.connections || []) connection.close();
            return;
          }
          smtpMessages.push(Buffer.concat(chunks));
          cb(null, 'accepted locally');
        });
      },
    });
    smtp.on('error', () => {});
    await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
    const smtpPort = smtp.server.address().port;
    provider.smtp = async () =>
      require('mailbox-nodemailer').createTransport({
        host: '127.0.0.1',
        port: smtpPort,
        secure: true,
        tls: { servername: 'localhost', ca: cert, rejectUnauthorized: true },
        auth: { user: 'local-mail', pass: 'synthetic-password-only' },
        socketTimeout: 1500,
        connectionTimeout: 1500,
      });
    const { AuthSessionsService } = require(
        path.join(backend, 'dist/auth/auth-sessions.service'),
      ),
      sessions = app.get(AuthSessionsService);
    const users = {};
    const tokens = {};
    for (const [name, role] of [
      ['superadmin', 'SUPERADMIN'],
      ['reader', 'ADMIN'],
      ['writer', 'ADMIN'],
      ['unassigned', 'ADMIN'],
      ['customer', 'USER'],
      ['friend', 'FRIEND'],
    ]) {
      users[name] = await db.user.create({
        data: { email: name + '@example.test', name: 'Prueba ' + name, role },
      });
      tokens[name] = await sessions.create(users[name]);
    }
    app
      .getHttpAdapter()
      .getInstance()
      .get('/__mailreview/:role', (req, res) => {
        const t = tokens[req.params.role];
        if (!t) return res.sendStatus(404);
        res.cookie('jwt', t.accessToken, { httpOnly: true, sameSite: 'lax' });
        res.cookie('refresh_token', t.refreshToken, {
          httpOnly: true,
          sameSite: 'lax',
        });
        res.redirect('/admin.html#section-inbox');
      });
    await app.listen(43121, '127.0.0.1');
    const request = async (
      route,
      method = 'GET',
      body,
      role = 'superadmin',
    ) => {
      const result = await fetch(
        'http://127.0.0.1:43121/api/admin/mailbox' + route,
        {
          method,
          headers: {
            Authorization: 'Bearer ' + tokens[role].accessToken,
            Origin: 'http://127.0.0.1:43121',
            Cookie: 'cronox_csrf_token=isolated-mailbox-csrf-000000000000',
            'x-csrf-token': 'isolated-mailbox-csrf-000000000000',
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
      return {
        status: result.status,
        body: (result.headers.get('content-type') || '').includes('json')
          ? await result.json()
          : await result.arrayBuffer(),
      };
    };
    const config = {
      name: 'Soporte',
      address: 'support@example.test',
      fromName: 'CRONOX',
      provider: 'hostinger',
      imapHost: 'imap.hostinger.com',
      imapPort: 993,
      smtpHost: 'smtp.hostinger.com',
      smtpPort: 465,
      username: 'support@example.test',
      active: true,
      notify: true,
      sentCopy: 'append',
      imapSecretRef: 'MAILBOX_TEST_PASS',
      smtpSecretRef: 'MAILBOX_TEST_PASS',
      permissions: [
        { userId: users.reader.id, access: 'read' },
        { userId: users.writer.id, access: 'send' },
      ],
    };
    let result = await request('/boxes', 'POST', config);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const boxId = result.body.boxes[0].id,
      store = new MockImapStore();
    stores.set(boxId, store);
    for (let i = 1; i <= 320; i++)
      store.folders.get('INBOX').rows.push(store.message(i, 'Mensaje ' + i));
    assert.equal(
      (await request('/boxes', 'POST', config, 'writer')).status,
      403,
    );
    assert.equal(
      (await request('/overview', 'GET', undefined, 'unassigned')).body.boxes
        .length,
      0,
    );
    for (const role of ['customer', 'friend'])
      assert.equal(
        (await request('/overview', 'GET', undefined, role)).status,
        403,
      );
    assert.equal(
      (await db.mailbox.findUnique({ where: { id: boxId } })).imapSecret,
      null,
    );
    assert.equal(
      JSON.stringify(result.body).includes('synthetic-password-only'),
      false,
    );
    pass(
      'Mailbox configuration, env references and role isolation; no secret returned',
    );
    for (const table of [
      'Mailbox',
      'MailboxPermission',
      'MailboxFolder',
      'MailboxMessage',
      'MailboxDraft',
      'MailboxSend',
      'MailboxFile',
      'MailboxNotice',
      'MailboxPushDevice',
      'MailboxAudit',
    ]) {
      const [priv] = await db.$queryRawUnsafe(
        `SELECT c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') AS anon_access,has_table_privilege('authenticated',c.oid,'SELECT') AS auth_access FROM pg_class c WHERE c.relname=$1`,
        table,
      );
      assert.equal(priv.relrowsecurity, true);
      assert.equal(priv.anon_access, false);
      assert.equal(priv.auth_access, false);
    }
    pass(
      'Every mail table private through RLS and role revocation; permanent histories untouched',
    );
    await sync.sync(boxId);
    assert.equal(
      await db.mailboxMessage.count({
        where: { mailboxId: boxId, alive: true },
      }),
      200,
    );
    assert.equal(await db.mailboxNotice.count(), 0);
    await sync.sync(boxId);
    assert.equal(
      await db.mailboxMessage.count({
        where: { mailboxId: boxId, alive: true },
      }),
      320,
    );
    await sync.sync(boxId);
    assert.equal(await db.mailboxMessage.count(), 320);
    assert.equal(store.readChanges, 0);
    pass(
      'Paginated initial import, dedup without Message-ID, no old notices or seen side effects',
    );
    store.folders.get('INBOX').rows[0].flags.add('\\Seen');
    store.folders.get('INBOX').rows.splice(1, 1);
    store.folders
      .get('INBOX')
      .rows.push(
        store.message(
          4294967293,
          'Nuevo mensaje con UID de 32 bits',
          new Date(),
        ),
      );
    await sync.sync(boxId);
    await sync.sync(boxId);
    await sync.sync(boxId);
    const newMessage = await db.mailboxMessage.findFirstOrThrow({
      where: { mailboxId: boxId, uid: 4294967293n, alive: true },
    });
    assert.equal(await db.mailboxNotice.count(), 1);
    assert.equal(
      (await db.mailboxMessage.findFirstOrThrow({ where: { uid: 1n } })).seen,
      true,
    );
    assert.equal(
      (await db.mailboxMessage.findFirstOrThrow({ where: { uid: 2n } })).alive,
      false,
    );
    assert.equal(
      (await request('/messages?mailboxId=' + boxId + '&state=unread&page=2'))
        .body.messages.length,
      25,
    );
    pass(
      'Incremental import, sparse unsigned 32-bit UID, external flags/deletes and server pagination',
    );
    assert.equal(
      (
        await request(
          '/messages/' + newMessage.id,
          'GET',
          undefined,
          'unassigned',
        )
      ).status,
      403,
    );
    result = await request(
      '/messages/' + newMessage.id,
      'GET',
      undefined,
      'reader',
    );
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert(!result.body.body.html.includes('<script'));
    assert(!result.body.body.html.includes('<form'));
    assert(!store.downloads.some((d) => d.part === '2'));
    assert.equal(store.readChanges, 0);
    const fileId = result.body.files[0].id;
    assert.equal(
      (await request('/files/' + fileId, 'GET', undefined, 'unassigned'))
        .status,
      403,
    );
    const file = await request('/files/' + fileId, 'GET', undefined, 'reader');
    assert.equal(file.status, 200);
    assert(Buffer.from(file.body).toString().startsWith('%PDF'));
    const downloadedCount = store.downloads.length;
    await request('/files/' + fileId, 'GET', undefined, 'reader');
    assert.equal(store.downloads.length, downloadedCount);
    assert.equal(
      (
        await request(
          '/messages/' + newMessage.id + '/action',
          'POST',
          { operation: 'read' },
          'reader',
        )
      ).status,
      201,
    );
    assert.equal(store.readChanges, 1);
    assert.equal(
      (
        await request(
          '/messages/' + newMessage.id + '/action',
          'POST',
          { operation: 'trash' },
          'reader',
        )
      ).status,
      403,
    );
    pass(
      'Lazy MIME parts, malicious HTML isolation, attachment authorization/cache and intentional seen flag',
    );
    const draft = (
      await request(
        '/drafts',
        'POST',
        { mailboxId: boxId, messageId: newMessage.id, mode: 'reply' },
        'writer',
      )
    ).body;
    assert.equal(draft.to, 'reply@example.test');
    assert.equal(draft.cc, '');
    assert(!draft.bcc);
    assert.equal(
      (await request('/drafts', 'POST', { mailboxId: boxId }, 'reader')).status,
      403,
    );
    assert.equal(
      (
        await request(
          '/drafts/' + draft.id,
          'PATCH',
          {
            to: 'a@example.test',
            cc: '',
            bcc: '',
            subject: 'Prueba',
            text: 'Texto recuperable',
            revision: draft.revision,
          },
          'writer',
        )
      ).status,
      200,
    );
    assert.equal(
      (await request('/drafts/' + draft.id, 'GET', undefined, 'writer')).body
        .text,
      'Texto recuperable',
    );
    assert.equal(
      (await request('/drafts/' + draft.id, 'GET', undefined, 'superadmin'))
        .status,
      403,
    );
    assert.equal(
      (
        await request(
          '/drafts/' + draft.id,
          'PATCH',
          {
            to: 'a@example.test',
            cc: '',
            bcc: '',
            subject: 'Prueba',
            text: 'stale',
            revision: draft.revision,
          },
          'writer',
        )
      ).status,
      409,
    );
    pass(
      'Single Reply-To, private persistent drafts and optimistic conflict protection',
    );
    result = await request('/boxes/' + boxId + '/test', 'POST');
    assert.equal(result.body.imap, 'TLS_AUTH_OK');
    assert.equal(result.body.smtp, 'TLS_AUTH_OK');
    assert.equal(smtpMessages.length, 0);
    pass(
      'Explicit connection diagnostic verifies local SMTP TLS/auth without sending',
    );
    process.env.MAILBOX_WORKER_ENABLED = 'true';
    process.env.MAILBOX_SEND_ENABLED = 'true';
    const makeDraft = async (subject) => {
      // Historical manual drafts are preserved; new free messages are no longer created by the API.
      const d = await db.mailboxDraft.create({data:{mailboxId:boxId,userId:users.writer.id}});
      return (
        await request(
          '/drafts/' + d.id,
          'PATCH',
          {
            to: 'a@example.test',
            cc: 'a@example.test, b@example.test',
            bcc: 'hidden@example.test',
            subject,
            text: 'Texto SMTP local',
            revision: d.revision,
          },
          'writer',
        )
      ).body;
    };
    let d = await makeDraft('Aceptado localmente'),
      requestKey = randomUUID();
    const clicks = await Promise.all([
      request(
        '/drafts/' + d.id + '/send',
        'POST',
        { requestKey, revision: d.revision },
        'writer',
      ),
      request(
        '/drafts/' + d.id + '/send',
        'POST',
        { requestKey, revision: d.revision },
        'writer',
      ),
    ]);
    assert(clicks.some((c) => c.status === 201));
    assert.equal(await db.mailboxSend.count({ where: { draftId: d.id } }), 1);
    await request(
      '/drafts/' + d.id + '/send',
      'POST',
      { requestKey, revision: d.revision },
      'writer',
    );
    let job = await db.mailboxSend.findFirstOrThrow({
      where: { draftId: d.id },
    });
    await sender.process(job.id);
    assert.equal(
      (await db.mailboxSend.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
      'SMTP_ACCEPTED',
    );
    assert.equal(smtpMessages.length, 1);
    const parsed = await require('mailparser').simpleParser(smtpMessages[0]);
    assert.equal(parsed.headers.has('bcc'), false);
    assert.equal(store.appends, 1);
    await sender.process(job.id);
    assert.equal(smtpMessages.length, 1);
    pass(
      'Real loopback SMTP/TLS acceptance, explicit enqueue, double-click protection, BCC privacy and Sent copy',
    );
    smtpMode = 'reject';
    d = await makeDraft('Rechazado localmente');
    let direct = await service.enqueue(
      { id: users.writer.id, role: 'ADMIN' },
      d.id,
      { requestKey: randomUUID(), revision: d.revision },
      {
        sid: (await sessions.verify(tokens.writer.accessToken, 'access')).id,
        sv: users.writer.sessionVersion,
      },
    );
    job = await db.mailboxSend.findFirstOrThrow({ where: { draftId: d.id } });
    await sender.process(job.id);
    assert.equal(
      (await db.mailboxSend.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
      'FAILED',
    );
    pass('SMTP rejection remains failed, with no automatic resend');
    smtpMode = 'uncertain';
    d = await makeDraft('Incierto localmente');
    await service.enqueue(
      { id: users.writer.id, role: 'ADMIN' },
      d.id,
      { requestKey: randomUUID(), revision: d.revision },
      {
        sid: (await sessions.verify(tokens.writer.accessToken, 'access')).id,
        sv: users.writer.sessionVersion,
      },
    );
    job = await db.mailboxSend.findFirstOrThrow({ where: { draftId: d.id } });
    await sender.process(job.id);
    assert.equal(
      (await db.mailboxSend.findUniqueOrThrow({ where: { id: job.id } }))
        .status,
      'UNKNOWN',
    );
    await sender.process(job.id);
    assert.equal(
      (
        await request(
          '/drafts/' + d.id + '/clone',
          'POST',
          { acknowledge: false },
          'writer',
        )
      ).status,
      400,
    );
    pass(
      'Connection loss after DATA is uncertain and requires explicit reviewed retry',
    );
    smtpMode = 'accept';
    store.appendFail = true;
    d = await makeDraft('Aceptado, copia falla');
    await service.enqueue(
      { id: users.writer.id, role: 'ADMIN' },
      d.id,
      { requestKey: randomUUID(), revision: d.revision },
      {
        sid: (await sessions.verify(tokens.writer.accessToken, 'access')).id,
        sv: users.writer.sessionVersion,
      },
    );
    job = await db.mailboxSend.findFirstOrThrow({ where: { draftId: d.id } });
    await sender.process(job.id);
    job = await db.mailboxSend.findUniqueOrThrow({ where: { id: job.id } });
    assert.equal(job.status, 'SMTP_ACCEPTED');
    assert.equal(job.sentCopyStatus, 'FAILED_OR_UNCERTAIN');
    assert.equal(smtpMessages.length, 2);
    store.appendFail = false;
    pass(
      'Sent-copy failure is separate from SMTP acceptance and never repeats the send',
    );
    const interrupted = await db.mailboxSend.create({
      data: {
        draftId: d.id,
        draftRevision: 999,
        userId: users.writer.id,
        sessionId: 'synthetic-interrupted',
        sessionVersion: 0,
        requestKey: randomUUID(),
        messageId: '<interrupted@example.test>',
        status: 'PROCESSING',
        startedAt: new Date(Date.now() - 600000),
      },
    });
    await sender.recover();
    assert.equal(
      (
        await db.mailboxSend.findUniqueOrThrow({
          where: { id: interrupted.id },
        })
      ).status,
      'UNKNOWN',
    );
    pass('Interrupted sends after restart become uncertain, not pending');
    let release;
    const blocking = leases.run(
      boxId,
      async () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    while (!release) await new Promise((r) => setTimeout(r, 10));
    await assert.rejects(
      () => leases.run(boxId, async () => {}),
      /MAILBOX_BUSY/,
    );
    release();
    await blocking;
    await db.mailbox.update({
      where: { id: boxId },
      data: { leaseToken: 'old-process', leaseUntil: new Date(0) },
    });
    await sync.sync(boxId);
    pass('Concurrent workers excluded and abandoned leases recover safely');
    store.fail = true;
    await assert.rejects(() => sync.sync(boxId));
    let failedBox = await db.mailbox.findUniqueOrThrow({
      where: { id: boxId },
    });
    assert.equal(failedBox.status, 'DISCONNECTED');
    assert(failedBox.nextSyncAt > new Date());
    store.fail = false;
    await sync.sync(boxId);
    assert.equal(
      (await db.mailbox.findUniqueOrThrow({ where: { id: boxId } })).status,
      'CONNECTED',
    );
    pass('Provider outage recorded with backoff and successful reconnection');
    const beforeReset = await db.mailboxMessage.count();
    store.folders.get('INBOX').validity = 101;
    await sync.sync(boxId);
    assert((await db.mailboxMessage.count()) > beforeReset);
    assert.equal(await db.mailboxNotice.count(), 1);
    pass(
      'UIDVALIDITY reset uses distinct references and suppresses historical notification replay',
    );
    const activeMessage = await db.mailboxMessage.findFirstOrThrow({
      where: { mailboxId: boxId, uid: 4294967293n, alive: true },
    });
    await sync.sync(boxId);
    assert.equal(
      (
        await request(
          '/messages/' + activeMessage.id + '/action',
          'POST',
          { operation: 'trash' },
          'writer',
        )
      ).status,
      201,
    );
    await sync.sync(boxId);
    assert.equal(
      (
        await request(
          '/messages/' + activeMessage.id + '/action',
          'POST',
          { operation: 'restore' },
          'writer',
        )
      ).status,
      201,
    );
    await sync.sync(boxId);
    assert.equal(await db.mailboxNotice.count(), 1);
    pass(
      'Move/restore with COPYUID preserves local reference and does not notify duplicates',
    );
    const security = require(
      path.join(backend, 'dist/mailbox/mailbox-security'),
    );
    security.resolvePublic = async () => ({ address: '8.8.8.8', family: 4 });
    const webpush = require('web-push');
    Object.assign(process.env, {
      MAILBOX_VAPID_PUBLIC_KEY: 'A'.repeat(87),
      MAILBOX_VAPID_PRIVATE_KEY: 'A'.repeat(43),
      MAILBOX_VAPID_SUBJECT: 'mailto:admin@example.test',
    });
    const pushed = [];
    webpush.sendNotification = async (_subscription, payload) => {
      pushed.push(JSON.parse(payload));
      return { statusCode: 201 };
    };
    const writerSession = await sessions.verify(
      tokens.writer.accessToken,
      'access',
    );
    const device = await push.subscribe(
      { id: users.writer.id, role: 'ADMIN' },
      { sid: writerSession.id, sv: users.writer.sessionVersion },
      {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/test-only',
          keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
        },
        mailboxIds: [boxId],
        name: 'Dispositivo de prueba',
        details: false,
      },
    );
    await push.deliver(device.id);
    assert.equal(pushed.length, 0);
    store.folders
      .get('INBOX')
      .rows.push(store.message(4294967294, 'Aviso nuevo', new Date()));
    await sync.sync(boxId);
    await push.deliver(device.id);
    assert.equal(pushed.length, 1);
    assert(!pushed[0].body.includes('Aviso nuevo'));
    await push.deliver(device.id);
    assert.equal(pushed.length, 1);
    pass(
      'Push simulation: no import flood, new arrival digest, generic payload and durable dedup',
    );
    await db.mailboxPermission.delete({
      where: {
        mailboxId_userId: { mailboxId: boxId, userId: users.writer.id },
      },
    });
    assert.equal(
      (
        await request(
          '/messages/' + activeMessage.id,
          'GET',
          undefined,
          'writer',
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/notices', 'GET', undefined, 'writer')).body.notices
        .length,
      0,
    );
    store.folders
      .get('INBOX')
      .rows.push(
        store.message(4294967295, 'Aviso tras revocación', new Date()),
      );
    await sync.sync(boxId);
    await push.deliver(device.id);
    assert.equal(pushed.length, 1);
    await db.authSession.update({
      where: { id: writerSession.id },
      data: { revokedAt: new Date() },
    });
    await push.deliver(device.id);
    assert.equal(
      (
        await db.mailboxPushDevice.findUniqueOrThrow({
          where: { id: device.id },
        })
      ).active,
      false,
    );
    pass(
      'Permission and session revocation stop message delivery and push subscriptions',
    );
    const superActor = { id: users.superadmin.id, role: 'SUPERADMIN' };
    const secondaryInput = {
      ...config,
      name: 'Información',
      address: 'info@example.test',
      username: 'info@example.test',
      permissions: [],
      imapSecretRef: '',
      smtpSecretRef: '',
      imapPassword: 'secondary-synthetic-only',
      smtpPassword: 'secondary-synthetic-only',
    };
    const added = await service.configure(
      superActor,
      undefined,
      secondaryInput,
    );
    const secondary = added.boxes.find(
      (b) => b.address === secondaryInput.address,
    );
    const storedSecondary = await db.mailbox.findUniqueOrThrow({
      where: { id: secondary.id },
    });
    assert(!JSON.stringify(added).includes('secondary-synthetic-only'));
    assert.notEqual(storedSecondary.imapSecret, secondaryInput.imapPassword);
    await service.configure(superActor, secondary.id, {
      ...secondaryInput,
      revision: secondary.revision,
      imapPassword: '',
      smtpPassword: '',
    });
    assert.equal(
      (await db.mailbox.findUniqueOrThrow({ where: { id: secondary.id } }))
        .imapSecret,
      storedSecondary.imapSecret,
    );
    const secondaryStore = new MockImapStore();
    stores.set(secondary.id, secondaryStore);
    secondaryStore.folders
      .get('INBOX')
      .rows.push(
        secondaryStore.message(1, 'Otro buzón'),
        secondaryStore.message(2, 'Cuerpo sin descargar'),
      );
    await sync.sync(secondary.id);
    const secondaryMessages = await db.mailboxMessage.findMany({
      where: { mailboxId: secondary.id },
      orderBy: { uid: 'asc' },
    });
    assert.equal(secondaryMessages.length, 2);
    assert.equal(
      (
        await request(
          '/messages?mailboxId=' + secondary.id,
          'GET',
          undefined,
          'reader',
        )
      ).status,
      403,
    );
    assert.equal(
      (await request('/messages')).body.pagination.total,
      await db.mailboxMessage.count({
        where: { alive: true, NOT: { flags: { hasSome: ['\\Draft', '\\Sent', '$Sent'] } }, folder: { available: true, OR: [{ specialUse: '\\Inbox' }, { path: 'INBOX', specialUse: null }] } },
      }),
    );
    assert.equal(
      (await request('/messages?mailboxId=' + secondary.id)).body.pagination
        .total,
      2,
    );
    assert.equal(
      (await request('/messages/' + secondaryMessages[0].id + '/status'))
        .status,
      200,
    );
    assert.equal(
      (
        await request(
          '/messages/' + secondaryMessages[0].id + '/status',
          'GET',
          undefined,
          'reader',
        )
      ).status,
      403,
    );
    await reader.body(superActor, secondaryMessages[0].id);
    await db.mailbox.update({
      where: { id: secondary.id },
      data: { active: false },
    });
    const beforeInactive = secondaryStore.downloads.length;
    assert.equal(
      (await request('/messages/' + secondaryMessages[0].id)).status,
      200,
    );
    assert.equal(
      (await request('/messages/' + secondaryMessages[1].id)).body.message,
      'MAILBOX_INACTIVE_CACHED_ONLY',
    );
    await sync.sync(secondary.id);
    assert.equal(secondaryStore.downloads.length, beforeInactive);
    pass(
      'Separate and combined mailboxes, encrypted passwords with blank-edit preservation, inactive cached-only reading',
    );

    const currentSecondary = await db.mailbox.findUniqueOrThrow({
      where: { id: secondary.id },
    });
    let fenceReady, assertOld;
    const fencedOperation = leases.run(
      secondary.id,
      async (_token, assertLease) => {
        assertOld = assertLease;
        await new Promise((resolve) => {
          fenceReady = resolve;
        });
        await assert.rejects(assertLease, /MAILBOX_LEASE_LOST/);
      },
    );
    while (!fenceReady) await new Promise((resolve) => setTimeout(resolve, 5));
    await service.configure(superActor, secondary.id, {
      ...secondaryInput,
      active: false,
      revision: currentSecondary.revision,
      imapPassword: '',
      smtpPassword: '',
    });
    await assert.rejects(assertOld, /MAILBOX_LEASE_LOST/);
    await assert.rejects(
      () => leases.run(secondary.id, async () => {}),
      /MAILBOX_BUSY/,
    );
    fenceReady();
    await fencedOperation;
    await db.mailbox.update({
      where: { id: secondary.id },
      data: { leaseUntil: null },
    });
    pass(
      'Configuration change fences existing operation and preserves lease cooldown to prevent overlapping connections',
    );

    const uploadDraft = await db.mailboxDraft.create({data:{mailboxId:boxId,userId:superActor.id}});
    const multipart = new FormData();
    multipart.append('file', new Blob(['isolated upload only']), 'review.txt');
    const upload = await fetch(
      'http://127.0.0.1:43121/api/admin/mailbox/drafts/' +
        uploadDraft.id +
        '/files',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + tokens.superadmin.accessToken,
          Origin: 'http://127.0.0.1:43121',
          Cookie: 'cronox_csrf_token=isolated-mailbox-csrf-000000000000',
          'x-csrf-token': 'isolated-mailbox-csrf-000000000000',
        },
        body: multipart,
      },
    );
    assert.equal(upload.status, 201);
    const uploadFile = await upload.json();
    assert.equal(
      (await request('/files/' + uploadFile.id, 'GET', undefined, 'reader'))
        .status,
      403,
    );
    assert.equal((await request('/files/' + uploadFile.id)).status, 200);
    await service.removeFile(superActor, uploadFile.id);
    pass(
      'Private multipart upload, ownership-checked download and draft attachment removal',
    );

    const superSession = await sessions.verify(
      tokens.superadmin.accessToken,
      'access',
    );
    const invalidDevice = await push.subscribe(
      superActor,
      { sid: superSession.id, sv: users.superadmin.sessionVersion },
      {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/isolated-expired-test',
          keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
        },
        mailboxIds: [boxId],
      },
    );
    const uncued = await db.mailboxMessage.findFirstOrThrow({
      where: { mailboxId: boxId, alive: true, notices: { none: {} } },
    });
    await db.mailboxNotice.create({
      data: { mailboxId: boxId, messageId: uncued.id },
    });
    webpush.sendNotification = async () => {
      throw Object.assign(Error('synthetic expired device'), {
        statusCode: 410,
      });
    };
    await push.deliver(invalidDevice.id);
    assert.equal(
      (
        await db.mailboxPushDevice.findUniqueOrThrow({
          where: { id: invalidDevice.id },
        })
      ).active,
      false,
    );
    pass(
      'Expired push subscriptions are disabled without contacting a push vendor',
    );

    const fencedDevice = await push.subscribe(
      superActor,
      { sid: superSession.id, sv: users.superadmin.sessionVersion },
      {
        subscription: {
          endpoint: 'https://fcm.googleapis.com/isolated-lease-test',
          keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
        },
        mailboxIds: [boxId],
      },
    );
    const remainingMessage = await db.mailboxMessage.findFirstOrThrow({
      where: { mailboxId: boxId, alive: true, notices: { none: {} } },
    });
    await db.mailboxNotice.create({
      data: { mailboxId: boxId, messageId: remainingMessage.id },
    });
    const resolveBeforeFence = security.resolvePublic,
      successorLease = new Date(Date.now() + 120000);
    security.resolvePublic = async () => {
      await db.mailboxPushDevice.update({
        where: { id: fencedDevice.id },
        data: { leaseUntil: successorLease },
      });
      return { address: '8.8.8.8', family: 4 };
    };
    let fencedDeliveries = 0;
    webpush.sendNotification = async () => {
      fencedDeliveries++;
    };
    await push.deliver(fencedDevice.id);
    security.resolvePublic = resolveBeforeFence;
    assert.equal(fencedDeliveries, 0);
    assert.equal(
      (
        await db.mailboxPushDevice.findUniqueOrThrow({
          where: { id: fencedDevice.id },
        })
      ).leaseUntil.getTime(),
      successorLease.getTime(),
    );
    await db.mailboxPushDevice.update({
      where: { id: fencedDevice.id },
      data: { active: false, leaseUntil: null },
    });
    pass('Expired push worker cannot send or clear the successor worker lease');

    // Restore isolated fixtures only for browser inspection; never production.
    await db.mailboxPermission.create({
      data: { mailboxId: boxId, userId: users.writer.id, access: 'send' },
    });
    await require('./review-mailbox-reading.cjs')({db,service,users,reader,leases,sync,provider,stores,pass});
    await require('./review-mailbox-campaigns.cjs')({app,db,backend,request,boxId,users,provider,smtpMessages,pass});
    await require('./review-mailbox-inbox-campaign-controls.cjs')({app,db,backend,request,boxId,users,smtpMessages,pass});
    assert.equal(await db.financeArchive.count(), 0);
    assert.equal(await db.dailyVisitor.count(), 0);
    await require('./review-admin-push.cjs')({app,db,backend,request,boxId,users,sessions,push,security,webpush,pass});
    tokens.writer = await sessions.create(users.writer);
    await db.mailboxSend.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'FAILED', errorCode: 'LOCAL_REVIEW_ONLY' },
    });
    process.env.MAILBOX_WORKER_ENABLED = 'false';
    process.env.MAILBOX_SEND_ENABLED = 'false';
    delete process.env.MAILBOX_VAPID_PUBLIC_KEY;
    delete process.env.MAILBOX_VAPID_PRIVATE_KEY;
    delete process.env.MAILBOX_VAPID_SUBJECT;
    const overview = await service.overview({
      id: users.superadmin.id,
      role: 'SUPERADMIN',
    });
    assert(!JSON.stringify(overview).includes('synthetic-password-only'));
    await fs.mkdir(path.join(root, 'output/mailbox-review'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(root, 'output/mailbox-review/integration-results.json'),
      JSON.stringify(
        {
          passes,
          provider: 'simulated IMAP',
          smtp: 'real loopback SMTP/TLS',
          push: 'simulated; no vendor contacted',
        },
        null,
        2,
      ),
    );
    if (process.argv.includes('--serve')) {
      console.log(
        'LOCAL REVIEW READY http://127.0.0.1:43121/__mailreview/superadmin (type stop to shut down)',
      );
      await new Promise(() => {});
    } else await stop();
  } catch (e) {
    console.error(e.stack || e);
    await stop();
    process.exitCode = 1;
  }
}
void main();
