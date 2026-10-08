'use strict';
const migrations=['20261008190000_consecutive_user_numbers','20261009010000_user_numbering_base_tables','20261009011000_daily_visitor_user_update_cascade','20261009020000_retired_user_references','20261009023000_deleted_account_order_history'];
function validate(state) {
 if(!state?.ready||state.migrations!==migrations.length||state.nextId!==state.total+1||state.maximum!==state.total||state.invalid||state.misordered) {
  throw Error('Controlled user numbering is not complete. Stop deployment and follow docs/user-numbering-2026-10-08.md: maintenance, recoverable backup, reviewed map, atomic apply. Do not let migrate deploy/restart bypass this operation.');
 }
 return true;
}
async function main() {
 const local=process.argv.includes('--local');
 if(!local&&!process.argv.includes('--deployment-check'))throw Error('Use --local or the explicit deployment check');
 let env;if(local)env=require('./start-local.cjs').loadLocalEnvironment();else{require('dotenv').config({path:process.env.CRONOX_ENV_FILE||'.env',quiet:true});env=process.env;}
 const {Client}=require('pg'),client=new Client({connectionString:env.USER_NUMBERING_DATABASE_URL||env.DATABASE_URL});await client.connect();
 try {
  await client.query('BEGIN READ ONLY');
  if(!(await client.query(`SELECT to_regclass('public."UserNumberingState"') IS NOT NULL AS present`)).rows[0].present)validate(null);
  const state=(await client.query(`SELECT s.ready,s."nextId" AS "nextId",(SELECT count(*)::integer FROM "User") total,
   (SELECT COALESCE(max(id),0) FROM "User") maximum,
   (SELECT count(*)::integer FROM "User" WHERE id<=0 OR "memberCode" IS DISTINCT FROM cronox_user_number_code(id)) invalid,
   (SELECT count(*)::integer FROM (SELECT "createdAt",lag("createdAt") OVER(ORDER BY id) previous FROM "User") u WHERE previous>"createdAt") misordered,
   (SELECT count(*)::integer FROM "_prisma_migrations" WHERE migration_name=ANY($1::text[]) AND finished_at IS NOT NULL AND rolled_back_at IS NULL) migrations
   FROM "UserNumberingState" s WHERE id=1`,[migrations])).rows[0];
  validate(state);await client.query('COMMIT');console.log('USER_NUMBERING_RELEASE_READY');
 }finally{await client.end();}
}
module.exports={validate,main};
if(require.main===module)main().catch(error=>{console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted connection]'));process.exitCode=1;});
