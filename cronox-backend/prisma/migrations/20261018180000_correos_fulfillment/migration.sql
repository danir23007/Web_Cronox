-- Additive. Deployment must back up and restore/compare in isolation first.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "Order" ADD COLUMN "trackingAttachedAt" TIMESTAMP(3),
  ADD COLUMN "trackingAdmissionLocalAt" TEXT,
  ADD COLUMN "trackingDeliveryLocalAt" TEXT,
  ADD COLUMN "trackingNotificationReview" TEXT;
ALTER TABLE "OrderTrackingAudit" ADD COLUMN "action" TEXT,
  ADD COLUMN "previousStatus" TEXT, ADD COLUMN "nextStatus" TEXT;

-- Preserve every existing assignment. Ambiguous duplicates block installation;
-- an operator must review the real associations, never guess or remove them.
CREATE UNIQUE INDEX "Order_correos_tracking_unique" ON "Order" (upper(btrim("trackingNumber")))
  WHERE lower(btrim("shippingCarrier"))='correos' AND "trackingNumber" IS NOT NULL AND btrim("trackingNumber")<>'';
CREATE UNIQUE INDEX "OrderTrackingNotification_shipped_once" ON "OrderTrackingNotification" ("orderId",revision)
  WHERE category='SHIPPED';

-- This cutover is durable, shared by every worker, and never reset on restart.
INSERT INTO "CorreosTrackingGate" (key,"notBefore") VALUES ('SHIPPED_EMAIL_CUTOFF',now()) ON CONFLICT (key) DO NOTHING;
-- Legacy milestone messages must never drain after enabling the new flow.
UPDATE "OrderTrackingNotification" SET status='CANCELLED',"leaseToken"=NULL,"leaseUntil"=NULL,"updatedAt"=now()
  WHERE category<>'SHIPPED' AND status IN ('PENDING','RETRY');
COMMIT;
