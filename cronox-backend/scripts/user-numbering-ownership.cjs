'use strict';
const crypto=require('node:crypto');
const fields=['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'];
const quote=s=>'"'+s.replaceAll('"','""')+'"';
async function inventory(client) {
 const fk=(await client.query(`SELECT c.relname AS table,a.attname AS column,f.confupdtype AS update_action,f.confdeltype AS delete_action
  FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
  WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND n.nspname='public' ORDER BY 1,2`)).rows;
 const named=(await client.query(`SELECT table_name AS table,column_name AS column,is_nullable FROM information_schema.columns c
  WHERE table_schema='public' AND EXISTS(SELECT 1 FROM information_schema.tables b WHERE b.table_schema=c.table_schema AND b.table_name=c.table_name AND b.table_type='BASE TABLE') AND data_type='integer' AND column_name=ANY($1::text[])
  AND table_name NOT IN ('User','UserIdentityReservation','UserNumberingState') ORDER BY 1,2`,[fields])).rows;
 const json=(await client.query(`SELECT table_name AS table,column_name AS column FROM information_schema.columns c
  WHERE table_schema='public' AND EXISTS(SELECT 1 FROM information_schema.tables b WHERE b.table_schema=c.table_schema AND b.table_name=c.table_name AND b.table_type='BASE TABLE') AND data_type='jsonb' AND table_name NOT IN ('UserNumberingRun','UserRetiredReference') ORDER BY 1,2`)).rows;
 return {foreignKeys:fk,nonForeignKeys:named.filter(n=>!fk.some(f=>f.table===n.table&&f.column===n.column)),json,targets:['AdminNote','AuditLog']};
}
async function ownership(client) {
 const inv=await inventory(client),users=(await client.query('SELECT id,"identityUid" FROM "User"')).rows;
 const identities=new Map(users.map(u=>[String(u.id),u.identityUid]));
 const columns=[...inv.foreignKeys,...inv.nonForeignKeys],records=[];
 const tables=new Set([...columns.map(c=>c.table),...inv.json.map(c=>c.table),...inv.targets]);
 function jsonRefs(value,path,emit,parent='') {
  if(Array.isArray(value))value.forEach((v,i)=>{if(parent==='userIds'&&identities.has(String(v)))emit(path+'.'+i,identities.get(String(v)));else jsonRefs(v,path+'.'+i,emit,parent==='account-records'?'account-record':parent);});
  else if(value&&typeof value==='object')for(const [key,v]of Object.entries(value)){
   if((fields.includes(key)||(parent==='account-record'&&key==='id'))&&identities.has(String(v)))emit(path+'.'+key,identities.get(String(v)));
   else jsonRefs(v,path+'.'+key,emit,key);
  }
 }
 for(const table of tables) {
  if(table==='LivePresence')continue; // Explicitly expired operational state, not retained history.
  const pk=(await client.query(`SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
   WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY array_position(i.indkey::smallint[],a.attnum)`,['public.'+quote(table)])).rows.map(x=>x.attname);
  if(!pk.length)throw Error('Ownership inventory needs a primary key: '+table);
  const refs=columns.filter(c=>c.table===table),json=inv.json.filter(c=>c.table===table);
  const selected=[...new Set([...pk,...refs.map(c=>c.column),...json.map(c=>c.column),...(inv.targets.includes(table)?['targetType','targetId']:[]),...(table==='AuditLog'?['actionType']:[])])];
  const rows=(await client.query('SELECT '+selected.map(quote).join(',')+' FROM '+quote(table))).rows;
  for(const row of rows) {
   const key=JSON.stringify(pk.map(k=>refs.some(c=>c.column===k)&&identities.has(String(row[k]))?identities.get(String(row[k])):row[k]));
   const emit=(column,uid)=>records.push(JSON.stringify([table,key,column,uid]));
   for(const ref of refs)if(identities.has(String(row[ref.column])))emit(ref.column,identities.get(String(row[ref.column])));
   if(inv.targets.includes(table)&&row.targetType==='user'&&identities.has(row.targetId))emit('targetId',identities.get(row.targetId));
   for(const column of json)jsonRefs(row[column.column],column.column,emit);
   if(table==='AdminBulkOperation'&&row.result?.kind==='users')jsonRefs(row.result.rows,'result.rows',emit,'account-records');
   if(table==='AuditLog'&&row.targetType==='users'&&row.actionType==='admin.bulk.update')jsonRefs(row.metadata?.records,'metadata.records',emit,'account-records');
  }
 }
 records.sort();return {inventory:inv,records,sha256:crypto.createHash('sha256').update(JSON.stringify(records)).digest('hex')};
}
module.exports={inventory,ownership};
