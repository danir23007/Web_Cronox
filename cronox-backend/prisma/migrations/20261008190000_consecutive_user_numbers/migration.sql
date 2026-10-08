BEGIN;
-- Preparation only. Account numbers are NOT changed by migrate deploy.
-- Apply the backed-up, reviewed map with cronox_compact_users afterwards.
ALTER TABLE "User" ADD COLUMN "identityUid" uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX "User_identityUid_key" ON "User"("identityUid");
CREATE TABLE "UserNumberingState" (id integer PRIMARY KEY, "nextId" integer NOT NULL, revision integer NOT NULL DEFAULT 0, ready boolean NOT NULL DEFAULT false);
INSERT INTO "UserNumberingState" VALUES (1, 1, 0, false);
CREATE TABLE "UserIdentityRegistry" ("identityUid" uuid PRIMARY KEY, "publicMemberToken" text UNIQUE);
INSERT INTO "UserIdentityRegistry" SELECT "identityUid", "publicMemberToken" FROM "User";
-- Reserve printed QR tokens of deleted accounts as well; they cannot validate a new account.
INSERT INTO "UserIdentityRegistry" SELECT gen_random_uuid(), r."publicMemberToken" FROM "UserIdentityReservation" r
WHERE r."publicMemberToken" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "UserIdentityRegistry" i WHERE i."publicMemberToken"=r."publicMemberToken");
CREATE TABLE "UserNumberingRun" (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "createdAt" timestamptz(6) NOT NULL DEFAULT now(), mapping jsonb NOT NULL, total integer NOT NULL, reason text NOT NULL);
-- Deleting an account removes its personal join records, not notes authored
-- for another account. Preserve stable historical authorship after deletion.
ALTER TABLE "Favorite" DROP CONSTRAINT "Favorite_userId_fkey";
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "DiscountCode" DROP CONSTRAINT "DiscountCode_userId_fkey";
ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE;
ALTER TABLE "AdminNote" ADD COLUMN "authorIdentityUid" uuid;
UPDATE "AdminNote" n SET "authorIdentityUid"=u."identityUid" FROM "User" u WHERE u.id=n."authorAdminId";
ALTER TABLE "AdminNote" ALTER COLUMN "authorAdminId" DROP NOT NULL;
ALTER TABLE "AdminNote" DROP CONSTRAINT "AdminNote_authorAdminId_fkey";
ALTER TABLE "AdminNote" ADD CONSTRAINT "AdminNote_authorAdminId_fkey" FOREIGN KEY ("authorAdminId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE FUNCTION cronox_note_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."authorAdminId" IS NOT NULL THEN SELECT "identityUid" INTO NEW."authorIdentityUid" FROM "User" WHERE id=NEW."authorAdminId"; END IF;
 IF TG_OP='UPDATE' AND OLD."authorIdentityUid" IS NOT NULL AND NEW."authorIdentityUid" IS DISTINCT FROM OLD."authorIdentityUid" THEN RAISE EXCEPTION 'Note author identity is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "AdminNote_author_identity" BEFORE INSERT OR UPDATE ON "AdminNote" FOR EACH ROW EXECUTE FUNCTION cronox_note_user_identity();

CREATE FUNCTION cronox_user_number_code(n integer) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT 'CRX' || CASE WHEN (n-1)/999999=0 THEN '' ELSE ((n-1)/999999)::text END || '-' || lpad((((n-1)%999999)+1)::text,6,'0')
$$;
CREATE FUNCTION cronox_user_number_plan() RETURNS jsonb LANGUAGE sql AS $$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('oldId',id,'newId',n,'createdAt',"createdAt"::text,'oldMemberCode',"memberCode",'identityUid',"identityUid") ORDER BY n),'[]'::jsonb)
 FROM (SELECT *,row_number() OVER (ORDER BY "createdAt",id)::integer n FROM "User") u
$$;

-- Rewrite ONLY explicitly named account fields. Never reinterpret arbitrary
-- numbers (product/order IDs), free text, email content or dates as user IDs.
CREATE FUNCTION cronox_remap_user_json(doc jsonb, mapping jsonb, parent text DEFAULT '') RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE k text; v jsonb; outdoc jsonb; target jsonb; n text;
BEGIN
 IF doc IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(doc)='object' THEN
  outdoc='{}';
  FOR k,v IN SELECT * FROM jsonb_each(doc) LOOP
   IF (k=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy']) OR (parent='account-record' AND k='id')) AND jsonb_typeof(v) IN ('number','string') THEN
    n=v#>>'{}'; target=mapping->n;
    IF target IS NOT NULL THEN v=CASE WHEN jsonb_typeof(v)='string' THEN to_jsonb(target#>>'{}') ELSE target END;
    ELSIF n ~ '^[0-9]+$' THEN v=to_jsonb('deleted:'||n); END IF;
   ELSE v=cronox_remap_user_json(v,mapping,k); END IF;
   outdoc=outdoc||jsonb_build_object(k,v);
  END LOOP;
  RETURN outdoc;
 ELSIF jsonb_typeof(doc)='array' THEN
  outdoc='[]';
  FOR v IN SELECT * FROM jsonb_array_elements(doc) LOOP
   IF parent='userIds' AND mapping ? (v#>>'{}') THEN v=mapping->(v#>>'{}');
   ELSIF parent='userIds' AND (v#>>'{}') ~ '^[0-9]+$' THEN v=to_jsonb('deleted:'||(v#>>'{}'));
   ELSE v=cronox_remap_user_json(v,mapping,CASE WHEN parent='account-records' THEN 'account-record' ELSE parent END); END IF;
   outdoc=outdoc||jsonb_build_array(v);
  END LOOP;
  RETURN outdoc;
 END IF;
 RETURN doc;
END $$;

CREATE FUNCTION cronox_compact_users(expected_total integer, expected_plan jsonb, why text) RETURNS uuid LANGUAGE plpgsql AS $$
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
  WHERE c.table_schema='public' AND c.data_type='integer' AND c.table_name NOT IN ('User','UserIdentityReservation','UserNumberingState')
  AND c.column_name=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'])
  AND NOT EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
   WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND f.conrelid=format('public.%I',c.table_name)::regclass AND a.attname=c.column_name)
 LOOP
  IF r.is_nullable='NO' THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I t WHERE %I>0 AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=t.%I))',r.table_name,r.column_name,r.column_name) INTO orphan;
   IF orphan THEN RAISE EXCEPTION 'Required orphan account reference %.%: review before compaction',r.table_name,r.column_name; END IF;
  END IF;
  EXECUTE format('UPDATE %I SET %I=%s WHERE %I>0 AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=%I.%I)',r.table_name,r.column_name,
   'NULL',r.column_name,r.table_name,r.column_name);
 END LOOP;
 -- Legacy target links to deleted users are visibly historical, never retargeted.
 UPDATE "AdminNote" SET "targetId"='deleted:'||"targetId" WHERE "targetType"='user' AND "targetId" ~ '^[0-9]+$' AND NOT EXISTS(SELECT 1 FROM "User" WHERE id::text="AdminNote"."targetId");
 UPDATE "AuditLog" SET "targetId"='deleted:'||"targetId" WHERE "targetType"='user' AND "targetId" ~ '^[0-9]+$' AND NOT EXISTS(SELECT 1 FROM "User" WHERE id::text="AuditLog"."targetId");
 FOR phase IN 1..2 LOOP
  SELECT COALESCE(jsonb_object_agg(CASE WHEN phase=1 THEN x->>'oldId' ELSE (-(x->>'oldId')::integer)::text END,
   CASE WHEN phase=1 THEN to_jsonb(-(x->>'oldId')::integer) ELSE x->'newId' END),'{}') INTO mapping FROM jsonb_array_elements(plan) x;
  -- Explicit non-FK integer references; FK columns are handled by ON UPDATE CASCADE.
  FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
   WHERE c.table_schema='public' AND c.data_type='integer' AND c.table_name NOT IN ('User','UserIdentityReservation','UserNumberingState')
   AND c.column_name=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'])
   AND NOT EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
    WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND f.conrelid=format('public.%I',c.table_name)::regclass AND a.attname=c.column_name)
  LOOP EXECUTE format('UPDATE %I SET %I=(($1->(%I::text))#>>''{}'')::integer WHERE $1 ? (%I::text)',r.table_name,r.column_name,r.column_name,r.column_name) USING mapping; END LOOP;
  -- Audit/notes target IDs have a semantic discriminator, not an FK.
  UPDATE "AdminNote" SET "targetId"=mapping->>"targetId" WHERE "targetType"='user' AND mapping ? "targetId";
  UPDATE "AuditLog" SET "targetId"=mapping->>"targetId" WHERE "targetType"='user' AND mapping ? "targetId";
  UPDATE "AdminBulkOperation" SET result=jsonb_set(result,'{rows}',cronox_remap_user_json(result->'rows',mapping,'account-records')) WHERE result->>'kind'='users' AND jsonb_typeof(result->'rows')='array';
  UPDATE "AuditLog" SET metadata=jsonb_set(metadata,'{records}',cronox_remap_user_json(metadata->'records',mapping,'account-records')) WHERE "targetType"='users' AND "actionType"='admin.bulk.update' AND jsonb_typeof(metadata->'records')='array';
  FOR r IN SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' AND data_type='jsonb' AND table_name<>'UserNumberingRun'
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

CREATE FUNCTION cronox_number_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; active boolean; previous_token text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW."identityUid" IS DISTINCT FROM OLD."identityUid" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'Account UUID and registration time are immutable'; END IF;
  IF (NEW.id IS DISTINCT FROM OLD.id OR NEW."memberCode" IS DISTINCT FROM OLD."memberCode") AND current_setting('cronox.user_numbering',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Use controlled user compaction'; END IF;
 ELSE
  SELECT "nextId",ready INTO n,active FROM "UserNumberingState" WHERE id=1 FOR UPDATE;
  IF NOT active THEN RAISE EXCEPTION 'Apply reviewed user numbering plan before accepting registrations'; END IF;
  IF EXISTS(SELECT 1 FROM "UserIdentityRegistry" WHERE "identityUid"=NEW."identityUid") THEN RAISE EXCEPTION 'Deleted account UUID cannot be reused'; END IF;
  IF NEW."createdAt"=transaction_timestamp()::timestamp(3) THEN NEW."createdAt"=clock_timestamp(); END IF;
  IF EXISTS(SELECT 1 FROM "User" WHERE "createdAt">NEW."createdAt") THEN RAISE EXCEPTION 'Backdated registration requires controlled import'; END IF;
  NEW.id=n; NEW."memberCode"=cronox_user_number_code(n);
  UPDATE "UserNumberingState" SET "nextId"=n+1 WHERE id=1;
  INSERT INTO "UserIdentityRegistry" VALUES(NEW."identityUid",NEW."publicMemberToken");
 END IF;
 IF TG_OP='UPDATE' AND OLD."publicMemberToken" IS NOT NULL AND NEW."publicMemberToken" IS DISTINCT FROM OLD."publicMemberToken" THEN RAISE EXCEPTION 'Printed QR token is immutable'; END IF;
 UPDATE "UserIdentityRegistry" SET "publicMemberToken"=NEW."publicMemberToken" WHERE "identityUid"=NEW."identityUid";
 RETURN NEW;
END $$;
CREATE FUNCTION cronox_lock_user_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 -- Deletions must enter through the operator, with exclusive lock acquired
 -- before DELETE's table locks; bare DELETE aborts, rather than racing traffic.
 IF current_setting('cronox.user_delete',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'Use controlled user deletion with backup and UUID'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION cronox_compact_after_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM cronox_compact_users((SELECT count(*)::integer FROM "User"),cronox_user_number_plan(),'controlled deletion'); RETURN NULL; END $$;
DROP TRIGGER "User_check_reserved_id" ON "User";
DROP TRIGGER "User_preserve_identity" ON "User";
CREATE TRIGGER "User_number_identity" BEFORE INSERT OR UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_number_user();
CREATE TRIGGER "User_delete_gate" BEFORE DELETE ON "User" FOR EACH STATEMENT EXECUTE FUNCTION cronox_lock_user_deletion();
CREATE TRIGGER "User_compact_deleted" AFTER DELETE ON "User" FOR EACH STATEMENT EXECUTE FUNCTION cronox_compact_after_user_delete();
-- Function calls operate with invoker privileges; no SECURITY DEFINER or public RPC.
DO $$ DECLARE t text; f record; BEGIN
 FOREACH t IN ARRAY ARRAY['UserNumberingState','UserIdentityRegistry','UserNumberingRun'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON %I FROM anon',t); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON %I FROM authenticated',t); END IF;
 END LOOP;
 FOR f IN SELECT oid::regprocedure name FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'cronox_%user%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',f.name);
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',f.name); END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated',f.name); END IF;
 END LOOP;
END $$;
COMMIT;
