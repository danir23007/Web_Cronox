'use strict';
// Produces reviewable SQL only; there is deliberately no connection or apply command.
const fs = require('node:fs');
const path = require('node:path');
function prepare(review, evidence, actorId) {
  const sessionActor = actorId === 'SESSION_ADMIN';
  if (!sessionActor && (!Number.isSafeInteger(actorId) || actorId < 1)) throw Error('A verified administrator ID is required');
  const actorSql = sessionActor ? "current_setting('cronox.recovery_actor_id', true)::integer" : String(actorId);
  if (!Array.isArray(evidence) || !evidence.length) throw Error('No approved historical evidence');
  const keys = new Set();
  const plan = evidence.map(entry => {
    const row = review.rows.find(row => row.orderId === entry.orderId && row.itemId === entry.itemId);
    if (!row || row.status === 'preserve') throw Error('Unknown line or historical cost already exists');
    const key = `${row.orderId}/${row.itemId}`;
    if (keys.has(key)) throw Error('Duplicate line'); keys.add(key);
    if (entry.approved !== true || !Number.isSafeInteger(entry.unitCostCents) || entry.unitCostCents < 0 || entry.unitCostCents > 2147483647 || typeof entry.source !== 'string' || entry.source.trim().length < 10) throw Error('An explicit cost, source and approval are required for every line');
    if (!Number.isSafeInteger(row.expectedRevision) || row.expectedRevision < 1) throw Error('Missing expected archive revision');
    return { orderId: row.orderId, itemId: row.itemId, productId: row.productId, expectedRevision: row.expectedRevision,
      unitCostCents: entry.unitCostCents, evidence: entry.source.trim() };
  }).sort((a, b) => a.orderId - b.orderId || a.itemId - b.itemId);
  const literal = JSON.stringify(plan).replace(/'/g, "''");
  let delimiter = '$recovery$';
  for (let suffix = 1; literal.includes(delimiter); suffix++) delimiter = `$recovery_${suffix}$`;
  return `-- REVIEW ONLY. Generated from approved per-line evidence; not automatically executed.
-- Keep this SQL private: it contains private product costs and evidence.
${sessionActor ? "-- Before executing, set cronox.recovery_actor_id to the verified administrator ID in the same session.\n" : ''}
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL standard_conforming_strings = on;
DO ${delimiter}
DECLARE plan jsonb := '${literal}'::jsonb; oid integer; a record; p jsonb; item jsonb; idx integer; doc jsonb; saved_cost integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "User" WHERE id = ${actorSql} AND role::text IN ('ADMIN','SUPERADMIN')) THEN RAISE EXCEPTION 'Invalid administrator'; END IF;
  FOR oid IN SELECT DISTINCT (value->>'orderId')::integer FROM jsonb_array_elements(plan) ORDER BY 1 LOOP
    PERFORM pg_advisory_xact_lock(73421, oid);
    SELECT * INTO a FROM "FinanceArchive" WHERE "orderId" = oid FOR UPDATE;
    IF NOT FOUND OR a.snapshot->>'source' <> 'IN_PERSON_ADMIN' THEN RAISE EXCEPTION 'Missing manual archive %', oid; END IF;
    doc := a.snapshot;
    FOR p IN SELECT value FROM jsonb_array_elements(plan) WHERE (value->>'orderId')::integer = oid LOOP
      IF a.revision <> (p->>'expectedRevision')::integer THEN RAISE EXCEPTION 'Archive changed: %', oid; END IF;
      SELECT value, (ordinality - 1)::integer INTO item, idx FROM jsonb_array_elements(doc->'items') WITH ORDINALITY
        WHERE (value->>'id')::integer = (p->>'itemId')::integer AND (value->>'productId')::integer = (p->>'productId')::integer;
      IF NOT FOUND OR item->'financialSnapshot'->>'unitCostCents' IS NOT NULL THEN RAISE EXCEPTION 'Line missing or cost already known: %', p->>'itemId'; END IF;
      SELECT f."unitCostCents" INTO saved_cost FROM "OrderItemFinancial" f WHERE f."itemId" = (p->>'itemId')::integer;
      IF saved_cost IS NOT NULL AND saved_cost <> (p->>'unitCostCents')::integer THEN RAISE EXCEPTION 'Conflicting saved cost: %', p->>'itemId'; END IF;
      doc := jsonb_set(doc, ARRAY['items',idx::text,'financialSnapshot'],
        (CASE WHEN jsonb_typeof(item->'financialSnapshot') = 'object' THEN item->'financialSnapshot'
          ELSE jsonb_build_object('productName',item->>'title','imageUrl',NULL) END) || jsonb_build_object('unitCostCents',(p->>'unitCostCents')::integer));
      INSERT INTO "OrderItemFinancial" ("itemId","unitCostCents","productName","imageUrl")
        SELECT i.id,(p->>'unitCostCents')::integer,COALESCE(item->'financialSnapshot'->>'productName',i.title),item->'financialSnapshot'->>'imageUrl'
        FROM "OrderItem" i WHERE i.id = (p->>'itemId')::integer AND i."orderId" = oid AND i."productId" = (p->>'productId')::integer
        ON CONFLICT ("itemId") DO UPDATE SET "unitCostCents" = EXCLUDED."unitCostCents" WHERE "OrderItemFinancial"."unitCostCents" IS NULL;
    END LOOP;
    UPDATE "FinanceArchive" SET snapshot = doc, revision = a.revision + 1 WHERE "orderId" = oid;
    INSERT INTO "FinanceArchiveRevision" ("orderId",revision,snapshot) VALUES (oid,a.revision + 1,doc);
    INSERT INTO "AuditLog" ("actorId",action,"actionType","targetType","targetId",reason,metadata)
      VALUES (${actorSql},'admin.manual_finance.recover','admin.manual_finance.recover','order',oid::text,'Reviewed manual cost recovery source',
        jsonb_build_object('previousRevision',a.revision,'items',(SELECT jsonb_agg(value) FROM jsonb_array_elements(plan) WHERE (value->>'orderId')::integer = oid)));
  END LOOP;
END ${delimiter};
-- Only unit costs, archive revisions and audit records change. Prices, dates, orders and stock remain intact.
COMMIT;
`;
}
if (require.main === module) {
  try {
    const [reportFile, evidenceFile, actor, outputFile] = process.argv.slice(2);
    if (!outputFile) throw Error('Usage: node prepare-manual-finance-recovery.cjs review.json evidence.json ADMIN_ID output.sql');
    const sql = prepare(JSON.parse(fs.readFileSync(reportFile)), JSON.parse(fs.readFileSync(evidenceFile)), actor === 'SESSION_ADMIN' ? actor : Number(actor));
    fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true }); fs.writeFileSync(outputFile, sql);
    console.log('SQL prepared for review; no database connection or writes performed.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };
