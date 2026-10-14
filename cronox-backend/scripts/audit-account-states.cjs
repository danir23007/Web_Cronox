'use strict';
// No secrets/PII in output. Default is read-only; review recording only stores audit evidence.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
// Prisma stores UTC in timestamp-without-time-zone columns.
require('pg').types.setTypeParser(1114, value => new Date(value.replace(' ', 'T') + 'Z'));
const { loadLocalEnvironment } = require('./start-local.cjs');
const migration = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261015120000_customer_account_enablement/migration.sql'), 'utf8');
const planSql = migration.split('-- ACCOUNT_STATE_APPLY:')[0]
  .replace('BEGIN;', 'BEGIN ISOLATION LEVEL REPEATABLE READ;')
  .replace(/LOCK TABLE[^;]+;/g, '');
const planQuery = planSql.slice(planSql.indexOf('WITH evidence'));
const arg = name => process.argv.find(v => v.startsWith(name + '='))?.slice(name.length + 1);
async function run() {
  const env = arg('--env-file') ? require('dotenv').parse(fs.readFileSync(path.resolve(arg('--env-file')))) : loadLocalEnvironment();
  const db = new Client({ connectionString: env.DIRECT_URL || env.DATABASE_URL });
  try {
    await db.connect();
    if (arg('--record-reviewed-plan')) {
      const plan = JSON.parse(fs.readFileSync(path.resolve(arg('--record-reviewed-plan')), 'utf8'));
      if (!Array.isArray(plan) || !plan.length) throw new Error('EMPTY_REVIEW');
      await db.query('BEGIN');
      for (const row of plan) {
        if (!['ACTIVE','INACTIVE'].includes(row.accountState) || row.reviewed !== true || typeof row.reason !== 'string' || !row.reason.trim()) throw new Error('REVIEW_REQUIRED');
        const current = (await db.query('SELECT id,"identityUid","accountState"::text AS state,"updatedAt" FROM "User" WHERE "identityUid"=$1 FOR UPDATE', [row.identityUid])).rows[0];
        if (!current || current.state !== row.expectedState || current.updatedAt.toISOString() !== row.expectedUpdatedAt) throw new Error('STALE_REVIEW');
        // Only resolve legacy/contradictory cases, never change an already disabled account.
        if (current.state === 'INACTIVE' && row.accountState !== 'INACTIVE') throw new Error('DISABLED_ACCOUNT_PROTECTED');
        await db.query(`INSERT INTO "AuditLog" ("requestKey",action,"actionType","targetType","targetId",metadata)
          VALUES ($1,'account-state.review.v1','account-state.review.v1','user',$2,$3::jsonb)
          ON CONFLICT ("requestKey") DO UPDATE SET metadata=EXCLUDED.metadata,"createdAt"=now()`,
        ['account-state-v1:' + current.identityUid, String(current.id), JSON.stringify(row)]);
      }
      await db.query('COMMIT');
    }
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const rows = (await db.query(planQuery)).rows.sort((a,b)=>a.id-b.id);
    const counts = { total: rows.length, wouldBecomeActive: 0, wouldRemainInactive: 0, unchangedActive: 0, reviewRequired: 0, unknownStates: 0 };
    for (const r of rows) {
      if (r.reason === 'unknown_state') counts.unknownStates++;
      else if (!r.after) counts.reviewRequired++;
      else if (r.after === 'INACTIVE') counts.wouldRemainInactive++;
      else if (r.before !== r.after) counts.wouldBecomeActive++;
      else counts.unchangedActive++;
    }
    if (arg('--write-plan')) {
      const review = rows.filter(r => !r.after).map(r => ({ identityUid:r.identityUid, id:r.id, role:r.role,
        expectedState:r.before, expectedUpdatedAt:r.updatedAt.toISOString(),
        accountState: null, reviewed:false, reason:'' }));
      fs.writeFileSync(path.resolve(arg('--write-plan')), JSON.stringify(review, null, 2), { flag:'wx' });
    }
    await db.query('ROLLBACK');
    console.log(JSON.stringify(counts, null, 2));
    if (counts.unknownStates || counts.reviewRequired) process.exitCode=2;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    console.error('Account-state audit failed: ' + (['EMPTY_REVIEW','REVIEW_REQUIRED','STALE_REVIEW','DISABLED_ACCOUNT_PROTECTED'].includes(e.message) ? e.message : (e.code || 'CHECK_LOCAL_CONFIGURATION')));
    process.exitCode=1;
  } finally { await db.end(); }
}
if (require.main === module) run();
module.exports = { planSql, planQuery };
