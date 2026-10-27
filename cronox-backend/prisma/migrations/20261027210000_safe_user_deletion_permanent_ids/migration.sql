BEGIN;

-- A durable receipt is independent of audit-log retention and of the deleted row.
CREATE TABLE "AdminUserDeletion" (
  "userId" INTEGER PRIMARY KEY,
  "identityUid" UUID NOT NULL UNIQUE,
  "memberCode" TEXT,
  "performedById" INTEGER NOT NULL,
  "deletedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "User_createdAt_id_idx" ON "User"("createdAt",id);
ALTER TABLE "AdminUserDeletion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AdminUserDeletion" FROM PUBLIC;

-- Never reduce the allocation cursor, including numbers reserved before a
-- historical compaction. No live account, code, QR or relationship is rewritten.
UPDATE "UserNumberingState" SET "nextId" = GREATEST("nextId",
  COALESCE((SELECT max(id) + 1 FROM "User"), 1),
  COALESCE((SELECT max("userId") + 1 FROM "UserIdentityReservation"), 1),
  COALESCE((SELECT max(COALESCE(NULLIF(parts[1], '')::bigint, 0) * 999999 + parts[2]::bigint) + 1
    FROM (SELECT regexp_match("memberCode", '^CRX([0-9]*)-([0-9]{6})$') parts FROM "UserIdentityReservation"
      UNION ALL SELECT regexp_match("memberCode", '^CRX([0-9]*)-([0-9]{6})$') FROM "User") codes), 1)::integer)
WHERE id = 1;
-- Empty installations need no identity rewrite or compaction to start issuing
-- permanent numbers. A nonempty unreviewed installation still fails closed.
UPDATE "UserNumberingState" SET ready=true WHERE id=1 AND NOT EXISTS(SELECT 1 FROM "User");

CREATE OR REPLACE FUNCTION cronox_number_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE n integer; active boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW."memberCode" IS DISTINCT FROM OLD."memberCode"
      OR NEW."identityUid" IS DISTINCT FROM OLD."identityUid" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
      OR (OLD."publicMemberToken" IS NOT NULL AND NEW."publicMemberToken" IS DISTINCT FROM OLD."publicMemberToken") THEN
      RAISE EXCEPTION 'Permanent user identity cannot be changed';
    END IF;
    UPDATE "UserIdentityRegistry" SET "publicMemberToken"=NEW."publicMemberToken" WHERE "identityUid"=NEW."identityUid";
  ELSE
    SELECT "nextId", ready INTO n, active FROM "UserNumberingState" WHERE id=1 FOR UPDATE;
    IF active IS DISTINCT FROM true THEN RAISE EXCEPTION 'User numbering is not initialized'; END IF;
    IF EXISTS (SELECT 1 FROM "UserIdentityRegistry" WHERE "identityUid"=NEW."identityUid") THEN
      RAISE EXCEPTION 'Account UUID has already been assigned';
    END IF;
    NEW.id = n; NEW."memberCode" = cronox_user_number_code(n);
    INSERT INTO "UserIdentityReservation" ("userId", "memberCode", "publicMemberToken")
      VALUES (NEW.id, NEW."memberCode", NEW."publicMemberToken");
    INSERT INTO "UserIdentityRegistry" ("identityUid", "publicMemberToken") VALUES (NEW."identityUid", NEW."publicMemberToken");
    UPDATE "UserNumberingState" SET "nextId"=n+1 WHERE id=1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS "User_compact_deleted" ON "User";
CREATE OR REPLACE FUNCTION cronox_compact_users(expected_total integer, expected_plan jsonb, why text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Permanent user IDs cannot be compacted; use list ordinals'; END $$;
CREATE OR REPLACE FUNCTION cronox_compact_users_v4(expected_total integer, expected_plan jsonb, why text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Permanent user IDs cannot be compacted; use list ordinals'; END $$;

-- Unknown dependent relations fail closed. Only disposable profile/access data
-- is allowed to cascade; traceability records, including nullable FKs, block.
CREATE FUNCTION cronox_user_delete_blockers(target integer) RETURNS TABLE(relation text, total bigint) LANGUAGE plpgsql STABLE AS $$
DECLARE r record; account jsonb; n bigint;
BEGIN
  SELECT to_jsonb(u) INTO account FROM "User" u WHERE id=target;
  IF account IS NULL THEN RETURN; END IF;
  FOR r IN
    SELECT c.relname AS tab, a.attname AS col, b.attname AS ref, format_type(a.atttypid,a.atttypmod) AS typ
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace ns ON ns.oid=c.relnamespace
      JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=f.conkey[1]
      JOIN pg_attribute b ON b.attrelid=f.confrelid AND b.attnum=f.confkey[1]
    WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND ns.nspname='public'
      AND c.relname <> ALL(ARRAY['Address','AuthSession','Favorite','Cart','PasswordResetToken','EmailChangeRequest',
        'PreRegistration','CircleReconciliationQueue','UserLoginEvent','AnalyticsSession','CustomerActivityEvent',
        'RestockRequest','DiscountCode','historial','AccountWelcomeBenefit','NewsletterSubscription','NewsletterMailJob','DailyVisitor'])
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I=($1->>%L)::%s',r.tab,r.col,r.ref,r.typ) INTO n USING account;
    IF n>0 THEN relation=r.tab||'.'||r.col; total=n; RETURN NEXT; END IF;
  END LOOP;
  -- Historical mail/operational authorship without FKs must stay attributable.
  FOR r IN SELECT c.table_name AS tab,c.column_name AS col FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
    WHERE c.table_schema='public' AND c.data_type='integer'
      AND c.table_name <> ALL(ARRAY['User','UserIdentityReservation','UserNumberingState','AdminUserDeletion','PromoCode','MailboxPermission','MailboxPushDevice','LivePresence'])
      AND c.column_name=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'])
      AND NOT EXISTS(SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
        WHERE f.contype='f' AND f.confrelid='"User"'::regclass AND f.conrelid=format('public.%I',c.table_name)::regclass AND a.attname=c.column_name)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I=$1',r.tab,r.col) INTO n USING target;
    IF n>0 THEN relation=r.tab||'.'||r.col; total=n; RETURN NEXT; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM "Order" WHERE lower(btrim("customerEmail"))=lower(btrim(account->>'email'));
  IF n>0 THEN relation='Order.customerEmail';total=n;RETURN NEXT; END IF;
  SELECT count(*) INTO n FROM "CheckoutSnapshot" WHERE lower(btrim("customerEmail"))=lower(btrim(account->>'email'));
  IF n>0 THEN relation='CheckoutSnapshot.customerEmail';total=n;RETURN NEXT; END IF;
  SELECT count(*) INTO n FROM "CheckoutSnapshot" s JOIN "Cart" c ON c.id=s."cartId" WHERE c."userId"=target;
  IF n>0 THEN relation='CheckoutSnapshot.cartId';total=n;RETURN NEXT; END IF;
  SELECT count(*) INTO n FROM "historial" WHERE "userId"=target AND ("pedidosRealizados">0 OR "articulosAdquiridos">0 OR devoluciones>0);
  IF n>0 THEN relation='historial';total=n;RETURN NEXT; END IF;
  SELECT count(*) INTO n FROM "DiscountCode" WHERE "userId"=target AND (used OR "usedAt" IS NOT NULL);
  IF n>0 THEN relation='DiscountCode.used';total=n;RETURN NEXT; END IF;
  SELECT count(*) INTO n FROM "PromoCode" p WHERE (p."ownerUserId"=target OR lower(btrim(p."ownerEmail"))=lower(btrim(account->>'email')))
    AND (p."usageCount">0 OR EXISTS(SELECT 1 FROM "Order" o WHERE o."promoCodeId"=p.id)
      OR EXISTS(SELECT 1 FROM "PromoCodeRedemption" d WHERE d."promoCodeId"=p.id)
      OR EXISTS(SELECT 1 FROM "CheckoutSnapshot" s WHERE s."promoCodeId"=p.id));
  IF n>0 THEN relation='PromoCode.used';total=n;RETURN NEXT; END IF;
  SELECT count(*) INTO n FROM "AccountWelcomeBenefit" WHERE "userId"=target AND
    ("originCheckoutId" IS NOT NULL OR "originOrderId" IS NOT NULL OR "firstOnlineOrderId" IS NOT NULL);
  IF n>0 THEN relation='AccountWelcomeBenefit.purchase';total=n;RETURN NEXT; END IF;
END $$;

CREATE OR REPLACE FUNCTION cronox_lock_user_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(current_setting('cronox.user_delete',true),'') !~ '^[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'Explicit administrator confirmation and stable identity required';
  END IF;
  RETURN NULL;
END $$;
CREATE FUNCTION cronox_safe_user_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('cronox.user_delete',true) IS DISTINCT FROM OLD."identityUid"::text
    OR NOT EXISTS(SELECT 1 FROM "AdminUserDeletion" WHERE "userId"=OLD.id AND "identityUid"=OLD."identityUid" AND "performedById"<>OLD.id)
    OR EXISTS(SELECT 1 FROM cronox_user_delete_blockers(OLD.id)) THEN
    RAISE EXCEPTION 'User has protected relations or lacks confirmed deletion receipt';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "User_safe_delete" BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_safe_user_delete();

DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON "AdminUserDeletion" FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION cronox_user_delete_blockers(integer),cronox_safe_user_delete() FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION cronox_user_delete_blockers(integer),cronox_safe_user_delete() FROM PUBLIC;
COMMIT;
