'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { Client } = require('pg');
const { loadLocalEnvironment } = require('./start-local.cjs');
(async () => {
  const env = loadLocalEnvironment();
  const db = new Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    // A temporary table shadows the real settings only on this connection.
    await db.query('CREATE TEMP TABLE "BlackFridaySettings" (LIKE public."BlackFridaySettings" INCLUDING ALL)');
    const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20261125140000_black_friday_initialize_private_settings/migration.sql'), 'utf8');
    await db.query(sql);
    const original = (await db.query('SELECT * FROM "BlackFridaySettings"')).rows;
    assert.equal(original.length, 1);
    assert.equal(original[0].enabled, false);
    assert.equal(original[0].bannerText, 'BLACK FRIDAY SOLO EN BLACK FRIDAY · 27/11 — DESDE EL 26/11 A LAS 21:00');
    assert.equal(original[0].startsAt.toISOString(), '2026-11-26T20:00:00.000Z');
    assert.equal(original[0].endsAt.toISOString(), '2026-11-27T23:00:00.000Z');
    await db.query('UPDATE "BlackFridaySettings" SET enabled = true, title = $1', ['Existing custom campaign']);
    const before = (await db.query('SELECT * FROM "BlackFridaySettings"')).rows;
    await db.query(sql);
    assert.deepEqual((await db.query('SELECT * FROM "BlackFridaySettings"')).rows, before);
    console.log('BLACK_FRIDAY_MIGRATION_OK: missing config disabled with approved defaults; existing config unchanged; temporary table only; rollback.');
  } finally { await db.query('ROLLBACK'); await db.end(); }
})().catch(error => { console.error(error.code || error.name); process.exitCode = 1; });
