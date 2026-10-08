BEGIN;
-- Historical references without a foreign key must never grant access to a
-- later account which happens to receive the same consecutive number.
CREATE TABLE "UserRetiredReference" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 "retiredAt" timestamptz(6) NOT NULL DEFAULT now(),
 "tableName" text NOT NULL, "columnName" text NOT NULL,
 "recordKey" jsonb NOT NULL, "previousNumber" integer NOT NULL,
 "identityUid" uuid
);
CREATE INDEX "UserRetiredReference_identityUid_idx" ON "UserRetiredReference"("identityUid");
CREATE FUNCTION cronox_user_reference_key(rel regclass, doc jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT COALESCE(jsonb_object_agg(a.attname,doc->a.attname),'{}'::jsonb)
 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey)
 WHERE i.indrelid=rel AND i.indisprimary
$$;
CREATE FUNCTION cronox_retire_user_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.data_type='integer'
 AND EXISTS(SELECT 1 FROM information_schema.tables b WHERE b.table_schema=c.table_schema AND b.table_name=c.table_name AND b.table_type='BASE TABLE')
 AND c.table_name NOT IN ('User','UserIdentityReservation','UserNumberingState')
 AND c.column_name=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'])
 AND NOT EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
 WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND f.conrelid=format('public.%I',c.table_name)::regclass AND a.attname=c.column_name)
 LOOP
  EXECUTE format('INSERT INTO "UserRetiredReference"("tableName","columnName","recordKey","previousNumber","identityUid") SELECT $1,$2,cronox_user_reference_key(%L::regclass,to_jsonb(t)),$3,$4 FROM %I t WHERE %I=$3',
   'public.'||quote_ident(r.table_name),r.table_name,r.column_name) USING r.table_name,r.column_name,OLD.id,OLD."identityUid";
 END LOOP;
 RETURN OLD;
END $$;
CREATE TRIGGER "User_retire_references" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_retire_user_references();
ALTER TABLE "UserRetiredReference" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "UserRetiredReference" FROM PUBLIC;
REVOKE ALL ON FUNCTION cronox_user_reference_key(regclass,jsonb),cronox_retire_user_references() FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON "UserRetiredReference" FROM %I',role_name);
   EXECUTE format('REVOKE ALL ON FUNCTION cronox_user_reference_key(regclass,jsonb),cronox_retire_user_references() FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION cronox_compact_users(expected_total integer, expected_plan jsonb, why text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE plan jsonb; r record; phase integer; mapping jsonb; run_id uuid; total integer; lock_tables text; orphan boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(824031,1);
 -- The same exclusive gate is held throughout the controlled deletion/migration.
 -- API requests hold the shared gate before authentication until response end.
 SELECT string_agg(format('%I.%I',n.nspname,c.relname),',' ORDER BY c.relname) INTO lock_tables
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r';
 EXECUTE 'LOCK TABLE '||lock_tables||' IN ACCESS EXCLUSIVE MODE';
 plan=cronox_user_number_plan(); total=jsonb_array_length(plan);
 IF total<>expected_total OR plan IS DISTINCT FROM expected_plan THEN RAISE EXCEPTION 'User plan changed; prepare a fresh backup and reviewed map'; END IF;
 IF EXISTS(SELECT 1 FROM "UserNumberingState" WHERE id=1 AND ready AND "nextId"=total+1)
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(plan) x WHERE x->>'oldId'<>x->>'newId' OR x->>'oldMemberCode'<>cronox_user_number_code((x->>'newId')::integer)) THEN RETURN NULL; END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND confrelid='"User"'::regclass AND confupdtype<>'c') THEN
  RAISE EXCEPTION 'Non-cascading User foreign key: review schema before renumbering';
 END IF;
 IF EXISTS(SELECT 1 FROM "User" WHERE id<=0) THEN RAISE EXCEPTION 'Invalid user IDs'; END IF;
 PERFORM set_config('cronox.user_numbering','on',true);
 -- Prevent sessions (even unchanged IDs) from surviving numeric ID reuse.
 UPDATE "AuthSession" SET "revokedAt"=COALESCE("revokedAt",now()),"previousRefreshHash"=NULL,"previousValidUntil"=NULL;
 UPDATE "User" SET "sessionVersion"="sessionVersion"+1;
 UPDATE "EmailChangeRequest" SET "expiresAt"=LEAST("expiresAt",now());
 UPDATE "MailboxPushDevice" SET active=false;
 -- Pending operational presence is not daily analytics and cannot outlive a revoked identity.
 DELETE FROM "LivePresence";
 -- Quarantine orphan numeric references: never accidentally attach them to a reused number.
 FOR r IN SELECT c.table_name,c.column_name,c.is_nullable FROM information_schema.columns c
  WHERE c.table_schema='public' AND EXISTS(SELECT 1 FROM information_schema.tables b WHERE b.table_schema=c.table_schema AND b.table_name=c.table_name AND b.table_type='BASE TABLE') AND c.data_type='integer' AND c.table_name NOT IN ('User','UserIdentityReservation','UserNumberingState')
  AND c.column_name=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'])
  AND NOT EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
   WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND f.conrelid=format('public.%I',c.table_name)::regclass AND a.attname=c.column_name)
 LOOP
  EXECUTE format('INSERT INTO "UserRetiredReference"("tableName","columnName","recordKey","previousNumber") SELECT $1,$2,cronox_user_reference_key(%L::regclass,to_jsonb(t)),t.%I FROM %I t WHERE t.%I>0 AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=t.%I) AND NOT EXISTS(SELECT 1 FROM "UserRetiredReference" a WHERE a."tableName"=$1 AND a."columnName"=$2 AND a."recordKey"=cronox_user_reference_key(%L::regclass,to_jsonb(t)) AND a."previousNumber"=t.%I AND a."retiredAt">=transaction_timestamp())',
   'public.'||quote_ident(r.table_name),r.column_name,r.table_name,r.column_name,r.column_name,'public.'||quote_ident(r.table_name),r.column_name) USING r.table_name,r.column_name;
  IF r.table_name='MailboxPermission' AND r.column_name='userId' THEN
   -- A deleted account has no permissions. Archive above keeps the old owner;
   -- removing the permission avoids a composite-PK collision between retirees.
   DELETE FROM "MailboxPermission" p WHERE NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=p."userId");
  ELSE
   IF r.is_nullable='NO' AND r.table_name NOT IN ('AdminBulkOperation','MailboxDraft','MailboxSend','MailboxPushDevice') THEN
    EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I t WHERE %I>0 AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=t.%I))',r.table_name,r.column_name,r.column_name) INTO orphan;
    IF orphan THEN RAISE EXCEPTION 'Unknown required orphan account reference %.%: review before compaction',r.table_name,r.column_name; END IF;
   END IF;
   -- Zero is a retired-owner sentinel, never a real User or a renumbering key.
   -- Historical rows retain their original stable UUID in the private archive.
   EXECUTE format('UPDATE %I SET %I=%s WHERE %I>0 AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=%I.%I)',r.table_name,r.column_name,
    CASE WHEN r.is_nullable='NO' THEN '0' ELSE 'NULL' END,r.column_name,r.table_name,r.column_name);
  END IF;
 END LOOP;
 -- Legacy target links to deleted users are visibly historical, never retargeted.
 UPDATE "AdminNote" SET "targetId"='deleted:'||"targetId" WHERE "targetType"='user' AND "targetId" ~ '^[0-9]+$' AND NOT EXISTS(SELECT 1 FROM "User" WHERE id::text="AdminNote"."targetId");
 UPDATE "AuditLog" SET "targetId"='deleted:'||"targetId" WHERE "targetType"='user' AND "targetId" ~ '^[0-9]+$' AND NOT EXISTS(SELECT 1 FROM "User" WHERE id::text="AuditLog"."targetId");
 FOR phase IN 1..2 LOOP
  SELECT COALESCE(jsonb_object_agg(CASE WHEN phase=1 THEN x->>'oldId' ELSE (-(x->>'oldId')::integer)::text END,
   CASE WHEN phase=1 THEN to_jsonb(-(x->>'oldId')::integer) ELSE x->'newId' END),'{}') INTO mapping FROM jsonb_array_elements(plan) x;
  -- Explicit non-FK integer references; FK columns are handled by ON UPDATE CASCADE.
  FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
   WHERE c.table_schema='public' AND EXISTS(SELECT 1 FROM information_schema.tables b WHERE b.table_schema=c.table_schema AND b.table_name=c.table_name AND b.table_type='BASE TABLE') AND c.data_type='integer' AND c.table_name NOT IN ('User','UserIdentityReservation','UserNumberingState')
   AND c.column_name=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'])
   AND NOT EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
    WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND f.conrelid=format('public.%I',c.table_name)::regclass AND a.attname=c.column_name)
  LOOP EXECUTE format('UPDATE %I SET %I=(($1->(%I::text))#>>''{}'')::integer WHERE $1 ? (%I::text)',r.table_name,r.column_name,r.column_name,r.column_name) USING mapping; END LOOP;
  -- Audit/notes target IDs have a semantic discriminator, not an FK.
  UPDATE "AdminNote" SET "targetId"=mapping->>"targetId" WHERE "targetType"='user' AND mapping ? "targetId";
  UPDATE "AuditLog" SET "targetId"=mapping->>"targetId" WHERE "targetType"='user' AND mapping ? "targetId";
  UPDATE "AdminBulkOperation" SET result=jsonb_set(result,'{rows}',cronox_remap_user_json(result->'rows',mapping,'account-records')) WHERE result->>'kind'='users' AND jsonb_typeof(result->'rows')='array';
  UPDATE "AuditLog" SET metadata=jsonb_set(metadata,'{records}',cronox_remap_user_json(metadata->'records',mapping,'account-records')) WHERE "targetType"='users' AND "actionType"='admin.bulk.update' AND jsonb_typeof(metadata->'records')='array';
  FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c WHERE c.table_schema='public' AND EXISTS(SELECT 1 FROM information_schema.tables b WHERE b.table_schema=c.table_schema AND b.table_name=c.table_name AND b.table_type='BASE TABLE') AND c.data_type='jsonb' AND table_name NOT IN ('UserNumberingRun','UserRetiredReference')
  LOOP EXECUTE format('UPDATE %I SET %I=cronox_remap_user_json(%I,$1) WHERE %I IS NOT NULL AND %I IS DISTINCT FROM cronox_remap_user_json(%I,$1)',r.table_name,r.column_name,r.column_name,r.column_name,r.column_name,r.column_name) USING mapping; END LOOP;
  UPDATE "User" SET id=(mapping->>id::text)::integer,
   "memberCode"=CASE WHEN phase=1 THEN 'RENUMBER:'||"identityUid"::text ELSE cronox_user_number_code((mapping->>id::text)::integer) END
   WHERE mapping ? id::text;
 END LOOP;
 UPDATE "UserNumberingState" SET "nextId"=total+1,revision=revision+1,ready=true WHERE id=1;
 -- PostgreSQL sequences are nontransactional; the coordinator is authoritative.
 -- Inserts override nextval with its transactional allocation, so rollback never leaves account gaps.
 PERFORM setval(pg_get_serial_sequence('"User"','id'),GREATEST(total,1),total>0);
 INSERT INTO "UserNumberingRun"(mapping,total,reason) VALUES(plan,total,why) RETURNING id INTO run_id;
 PERFORM set_config('cronox.user_numbering','off',true);
 RETURN run_id;
END $$;

COMMIT;
