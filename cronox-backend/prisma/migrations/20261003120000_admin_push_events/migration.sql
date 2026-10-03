BEGIN;
ALTER TABLE "MailboxPushDevice"
 ADD COLUMN "mailEnabled" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "paidOrdersSince" TIMESTAMPTZ(3),
 ADD COLUMN "visitsSince" TIMESTAMPTZ(3),
 ADD COLUMN "waitlistSince" TIMESTAMPTZ(3),
 ADD COLUMN "preferenceRevision" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "MailboxPushEvent" (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload JSONB NOT NULL, "occurredAt" TIMESTAMPTZ(3) NOT NULL
);
CREATE TABLE "MailboxPushDelivery" (
 "eventId" TEXT NOT NULL REFERENCES "MailboxPushEvent"(id) ON DELETE RESTRICT,
 "deviceId" TEXT NOT NULL, "enabledSince" TIMESTAMPTZ(3) NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING', attempts INTEGER NOT NULL DEFAULT 0,
 "readyAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "startedAt" TIMESTAMPTZ(3), "errorCode" TEXT,
 PRIMARY KEY ("eventId", "deviceId")
);
CREATE INDEX "MailboxPushDelivery_deviceId_status_readyAt_idx" ON "MailboxPushDelivery"("deviceId",status,"readyAt");
ALTER TABLE "MailboxPushEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MailboxPushDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "MailboxPushEvent", "MailboxPushDelivery" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN
  REVOKE ALL ON "MailboxPushEvent", "MailboxPushDelivery" FROM anon;
 END IF;
 IF EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN
  REVOKE ALL ON "MailboxPushEvent", "MailboxPushDelivery" FROM authenticated;
 END IF;
END $$;
-- Transactional outbox. A push-storage failure must never abort a business write.
-- The worker never contacts the push vendor inside these transactions.
CREATE FUNCTION cronox_enqueue_admin_push(k TEXT, object_key TEXT, data JSONB, at_time TIMESTAMPTZ)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE eid TEXT := k || ':' || object_key;
BEGIN
 INSERT INTO "MailboxPushEvent" (id,kind,payload,"occurredAt") VALUES(eid,k,data,at_time) ON CONFLICT DO NOTHING;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO "MailboxPushDelivery" ("eventId","deviceId","enabledSince")
 SELECT eid,d.id, CASE k WHEN 'paidOrders' THEN d."paidOrdersSince" WHEN 'visits' THEN d."visitsSince" WHEN 'waitlist' THEN d."waitlistSince" END
 FROM "MailboxPushDevice" d JOIN "User" u ON u.id=d."userId"
 WHERE d.active AND u."accountState"='ACTIVE' AND u.role IN ('ADMIN','SUPERADMIN')
 AND (k<>'paidOrders' OR u.role='SUPERADMIN')
 AND CASE k WHEN 'paidOrders' THEN d."paidOrdersSince" WHEN 'visits' THEN d."visitsSince" WHEN 'waitlist' THEN d."waitlistSince" END <= at_time;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION cronox_enqueue_admin_push(TEXT,TEXT,JSONB,TIMESTAMPTZ) FROM PUBLIC;

CREATE FUNCTION cronox_order_paid_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='PAID' AND NEW."paidAt" IS NOT NULL AND
 (TG_OP='INSERT' OR OLD."paidAt" IS NULL) THEN
  PERFORM cronox_enqueue_admin_push('paidOrders',NEW.id::text,
   jsonb_build_object('orderId',NEW.id,'total',NEW.total::text,'currency',NEW.currency),NEW."paidAt");
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER cronox_order_paid_push AFTER INSERT OR UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION cronox_order_paid_push();

CREATE FUNCTION cronox_waitlist_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE label TEXT; size TEXT;
BEGIN
 IF NEW.status='WAITING' THEN
  SELECT p.name,v.size::text INTO label,size FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE v.id=NEW."variantId";
  PERFORM cronox_enqueue_admin_push('waitlist',NEW.id,
   jsonb_build_object('product',label,'size',size),NEW."requestedAt");
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER cronox_waitlist_push AFTER INSERT ON "RestockRequest" FOR EACH ROW EXECUTE FUNCTION cronox_waitlist_push();
COMMIT;
