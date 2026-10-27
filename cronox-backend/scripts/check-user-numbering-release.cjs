'use strict';
const migrations=['20261008190000_consecutive_user_numbers','20261009010000_user_numbering_base_tables','20261009011000_daily_visitor_user_update_cascade','20261009020000_retired_user_references','20261009023000_deleted_account_order_history','20261027210000_safe_user_deletion_permanent_ids'];
function validate(state, {beforeMigrate=false}={}) {
 const legacy=beforeMigrate&&state?.migrations===migrations.length-1&&state.permanentApplied===false&&state.receiptExists===false
   &&state.maximum===state.total&&state.nextId===state.total+1&&state.misordered===0&&state.compactionEnabled===true;
 const permanent=state?.migrations===migrations.length&&state.permanentApplied===true&&state.receiptExists===true
   &&state.maximum>=state.total&&state.nextId>Math.max(state.maximum,state.reservedMaximum??0,state.reservedCodeMaximum??0)&&state.compactionEnabled===false;
 if(!state?.ready||state.invalid||(!legacy&&!permanent)) {
  throw Error('Permanent user numbering is not ready. Check the reviewed identity migrations and the monotonic allocation cursor; never compact or reuse account IDs.');
 }
 return true;
}
async function main(args=process.argv.slice(2)) {
 const local=args.includes('--local'),beforeMigrate=args.includes('--before-migrate');
 if(!local&&!args.includes('--deployment-check'))throw Error('Use --local or the explicit deployment check');
 let env;if(local)env=require('./start-local.cjs').loadLocalEnvironment();else{require('dotenv').config({path:process.env.CRONOX_ENV_FILE||'.env',quiet:true});env=process.env;}
 const {Client}=require('pg'),client=new Client({connectionString:env.USER_NUMBERING_DATABASE_URL||env.DATABASE_URL});await client.connect();
 try {
  await client.query('BEGIN READ ONLY');
  if(!(await client.query(`SELECT to_regclass('public."UserNumberingState"') IS NOT NULL AS present`)).rows[0].present)validate(null);
  const state=(await client.query(`SELECT s.ready,s."nextId" AS "nextId",(SELECT count(*)::integer FROM "User") total,
   (SELECT COALESCE(max(id),0) FROM "User") maximum,
   (SELECT count(*)::integer FROM "User" WHERE id<=0 OR "memberCode" IS DISTINCT FROM cronox_user_number_code(id)) invalid,
   (SELECT COALESCE(max("userId"),0) FROM "UserIdentityReservation") AS "reservedMaximum",
   (SELECT COALESCE(max(COALESCE(NULLIF(parts[1], '')::bigint,0)*999999+parts[2]::bigint),0)::float8 FROM (SELECT regexp_match("memberCode",'^CRX([0-9]*)-([0-9]{6})$') parts FROM "UserIdentityReservation") c) AS "reservedCodeMaximum",
   EXISTS(SELECT 1 FROM "_prisma_migrations" WHERE migration_name='20261027210000_safe_user_deletion_permanent_ids' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS "permanentApplied",
   to_regclass('public."AdminUserDeletion"') IS NOT NULL AS "receiptExists",
   EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='"User"'::regclass AND tgname='User_compact_deleted' AND NOT tgisinternal) AS "compactionEnabled",
   (SELECT count(*)::integer FROM (SELECT "createdAt",lag("createdAt") OVER(ORDER BY id) previous FROM "User") u WHERE previous>"createdAt") misordered,
   (SELECT count(*)::integer FROM "_prisma_migrations" WHERE migration_name=ANY($1::text[]) AND finished_at IS NOT NULL AND rolled_back_at IS NULL) migrations
   FROM "UserNumberingState" s WHERE id=1`,[migrations])).rows[0];
  validate(state,{beforeMigrate});await client.query('COMMIT');console.log(beforeMigrate?'USER_NUMBERING_MIGRATION_INPUT_READY':'USER_NUMBERING_RELEASE_READY');
 }finally{await client.end();}
}
module.exports={validate,main};
if(require.main===module)main().catch(error=>{console.error(error.message.replace(/postgres(?:ql)?:\/\/\S+/gi,'[redacted connection]'));process.exitCode=1;});
