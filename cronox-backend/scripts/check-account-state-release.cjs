'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const migrationName = '20261015120000_customer_account_enablement';
function assertReady({ states, claimColumn, stateColumn, legacyRows, migrationApplied, checksumMatches }) {
  if (JSON.stringify([...states].sort()) !== JSON.stringify(['ACTIVE','INACTIVE']) || !claimColumn || !stateColumn || Number(legacyRows) !== 0 || !migrationApplied || !checksumMatches) {
    throw new Error('Account-state maintenance required: stop old writers, review audit-account-states.cjs, back up/restore-test, and apply the reviewed migration before this release. See docs/customer-account-states-2026-10-14.md.');
  }
}
async function run() {
  require('dotenv').config({ path:process.env.CRONOX_ENV_FILE||path.join(__dirname,'../.env'), quiet:true });
  const { Client }=require('pg');
  const db=new Client({connectionString:process.env.DIRECT_URL||process.env.DATABASE_URL});
  try {
    await db.connect(); await db.query('BEGIN READ ONLY');
    const states=(await db.query(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE t.typname='UserAccountState' AND n.nspname=current_schema() ORDER BY enumsortorder`)).rows.map(r=>r.enumlabel);
    const claimColumn=(await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='User' AND column_name='registrationClaimable' AND is_nullable='NO' AND data_type='boolean' AND column_default='false'`)).rowCount===1;
    const stateColumn=(await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='User' AND column_name='accountState' AND is_nullable='NO' AND udt_name='UserAccountState' AND udt_schema=current_schema() AND column_default=$1`,["'ACTIVE'::\"UserAccountState\""])).rowCount===1;
    const legacyRows=(await db.query(`SELECT count(*) FROM "User" WHERE "accountState"::text NOT IN ('ACTIVE','INACTIVE')`)).rows[0].count;
    const history=(await db.query(`SELECT checksum,finished_at,rolled_back_at FROM "_prisma_migrations" WHERE migration_name=$1`,[migrationName])).rows.filter(row=>!row.rolled_back_at);
    const migrationApplied=history.length===1 && !!history[0].finished_at;
    const file=process.env.CRONOX_ACCOUNT_STATE_MIGRATION_FILE || path.join(__dirname,'../prisma/migrations',migrationName,'migration.sql');
    const checksum=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const checksumMatches=migrationApplied && history[0].checksum===checksum;
    assertReady({states,claimColumn,stateColumn,legacyRows,migrationApplied,checksumMatches}); await db.query('COMMIT');
    console.log('Account-state schema is ready for the compatible release.');
  } catch(e) { await db.query('ROLLBACK').catch(()=>{}); console.error(e.message.startsWith('Account-state maintenance')?e.message:'Account-state preflight failed; deployment stopped.'); process.exitCode=1; }
  finally { await db.end(); }
}
if(require.main===module) run();
module.exports={assertReady};
