'use strict';
// This runner deliberately accepts only the project's protected loopback DB.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const flags = process.argv.slice(2);
if (flags.some(flag => !['--apply', '--verify'].includes(flag))) {
  throw new Error('Opciones válidas: --apply o --verify; sin opciones solo consulta.');
}
const env = loadLocalEnvironment();
ensureLocalPostgres(env);
const database = new URL(env.DATABASE_URL);
const executable = path.join(env.LOCAL_PG_BIN, process.platform === 'win32' ? 'psql.exe' : 'psql');
const run = sql => {
  const result = spawnSync(executable, ['-X', '-v', 'ON_ERROR_STOP=1'], {
    input: sql, encoding: 'utf8', windowsHide: true,
    env: { ...env, PGHOST: database.hostname, PGPORT: database.port || '5432',
      PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
      PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password) },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || 'Falló PostgreSQL local.');
  console.log(result.stdout.trim());
};
const repair = fs.readFileSync(path.join(__dirname, 'replace-obsolete-contact-email.sql'), 'utf8');
if (flags.includes('--verify')) {
  // Test the exact SQL against a temporary table, never persisted content.
  const update = repair.slice(repair.indexOf('UPDATE '), repair.lastIndexOf('COMMIT;'));
  run(`BEGIN;
    CREATE TEMP TABLE email_repair_test (slug text, html text, revision int, "updatedAt" timestamp);
    INSERT INTO email_repair_test VALUES ('test', '<h1>Test</h1><a href="mailto:DANI.RIVAS@CRONOX.ES">dani.rivas@cronox.es</a> info@cronox.es', 7, now());
    ${update.replaceAll('"FooterPageContent"', 'email_repair_test')}
    ${update.replaceAll('"FooterPageContent"', 'email_repair_test')}
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM email_repair_test WHERE revision = 8 AND html = '<h1>Test</h1><a href="mailto:support@cronox.es">support@cronox.es</a> info@cronox.es')
      THEN RAISE EXCEPTION 'Replacement, other mailbox preservation or idempotency failed'; END IF;
    END $$;
    ROLLBACK;`);
} else if (flags.includes('--apply')) {
  run(repair);
} else {
  run(`SELECT "slug", "revision" FROM "FooterPageContent" WHERE "html" ~* 'dani\\.rivas@cronox\\.es' ORDER BY "slug";`);
  run(`SELECT 'FooterSettings' AS source, count(*) AS matches FROM "FooterSettings" t WHERE to_jsonb(t)::text ~* 'dani\\.rivas@cronox\\.es'
    UNION ALL SELECT 'ManagedEmailTemplate', count(*) FROM "ManagedEmailTemplate" t WHERE to_jsonb(t)::text ~* 'dani\\.rivas@cronox\\.es';`);
}
