BEGIN;
-- Removing an account keeps orders and completed checkout records. Their
-- attribution is archived by immutable UUID before the nullable FK is cleared.
ALTER TABLE "Order" DROP CONSTRAINT "Order_userId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "CheckoutSnapshot" DROP CONSTRAINT "CheckoutSnapshot_userId_fkey";
ALTER TABLE "CheckoutSnapshot" ADD CONSTRAINT "CheckoutSnapshot_userId_fkey" FOREIGN KEY("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE SET NULL;

-- An orphan personal promotion must not become an unrestricted promotion.
ALTER FUNCTION cronox_compact_users(integer,jsonb,text) RENAME TO cronox_compact_users_v4;
CREATE FUNCTION cronox_compact_users(expected_total integer, expected_plan jsonb, why text) RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(824031,1);
 UPDATE "PromoCode" p SET "isActive"=false WHERE p."ownerUserId">0 AND NOT EXISTS(SELECT 1 FROM "User" u WHERE u.id=p."ownerUserId");
 RETURN cronox_compact_users_v4(expected_total,expected_plan,why);
END $$;
REVOKE ALL ON FUNCTION cronox_compact_users(integer,jsonb,text) FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON FUNCTION cronox_compact_users(integer,jsonb,text) FROM %I',role_name);
  END IF;
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION cronox_retire_user_references() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
 IF EXISTS(SELECT 1 FROM "CheckoutSnapshot" WHERE "userId"=OLD.id AND "orderId" IS NULL AND status NOT IN ('REPLACED','EXPIRED','PAYMENT_CANCELLED','PAYMENT_CREATION_FAILED')) THEN
  RAISE EXCEPTION 'Unresolved checkout: finish or safely cancel payment before deleting account';
 END IF;
 UPDATE "PromoCode" SET "isActive"=false WHERE "ownerUserId"=OLD.id;
 FOR r IN SELECT c.table_name,c.column_name FROM information_schema.columns c
 WHERE c.table_schema='public' AND c.data_type='integer'
 AND EXISTS(SELECT 1 FROM information_schema.tables b WHERE b.table_schema=c.table_schema AND b.table_name=c.table_name AND b.table_type='BASE TABLE')
 AND c.table_name NOT IN ('User','UserIdentityReservation','UserNumberingState')
 AND c.column_name=ANY(ARRAY['userId','actorId','authorAdminId','ownerUserId','processedById','recordedById','voidedById','createdBy','updatedBy'])

 LOOP
  EXECUTE format('INSERT INTO "UserRetiredReference"("tableName","columnName","recordKey","previousNumber","identityUid") SELECT $1,$2,cronox_user_reference_key(%L::regclass,to_jsonb(t)),$3,$4 FROM %I t WHERE %I=$3',
   'public.'||quote_ident(r.table_name),r.table_name,r.column_name) USING r.table_name,r.column_name,OLD.id,OLD."identityUid";
 END LOOP;
 RETURN OLD;
END $$;

COMMIT;
