BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
ALTER TABLE "CheckoutEffect" ADD COLUMN "accountScenario" TEXT;
ALTER TABLE "Order" ADD COLUMN "trackingFlowStartedAt" TIMESTAMP(3), ADD COLUMN "trackingCategory" TEXT;
ALTER TABLE "OrderTrackingEvent" ADD COLUMN origin TEXT NOT NULL DEFAULT 'CORREOS';
ALTER TABLE "OrderTrackingNotification" ADD COLUMN "noticeKey" TEXT,
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'CORREOS', ADD COLUMN "transitionFrom" TEXT,
  ADD COLUMN "transitionTo" TEXT, ADD COLUMN "suppressionReason" TEXT;
DROP INDEX "OrderTrackingNotification_eventId_key";
CREATE INDEX "OrderTrackingNotification_eventId_idx" ON "OrderTrackingNotification"("eventId");
-- Preserve every historical row, while giving an existing logical shipment or
-- delivery notice precedence over either producer in the coordinated flow.
UPDATE "OrderTrackingNotification" SET "noticeKey"='LEGACY:'||id;
WITH chosen AS (
 SELECT DISTINCT ON ("orderId",category) id,"orderId",category FROM "OrderTrackingNotification"
 WHERE category IN ('SHIPPED','DELIVERED')
 ORDER BY "orderId",category,CASE status WHEN 'SENT' THEN 0 WHEN 'UNKNOWN' THEN 1 WHEN 'SENDING' THEN 2 ELSE 3 END,"createdAt"
) UPDATE "OrderTrackingNotification" n SET "noticeKey"='ORDER:'||c."orderId"||':'||c.category FROM chosen c WHERE n.id=c.id;
CREATE UNIQUE INDEX "OrderTrackingNotification_noticeKey_key" ON "OrderTrackingNotification"("noticeKey");
INSERT INTO "CorreosTrackingGate" (key,"notBefore") VALUES ('LOGISTICS_EMAIL_CUTOFF',now()) ON CONFLICT (key) DO NOTHING;
-- No guessing an account-creation scenario from current user state or age.
UPDATE "CheckoutEffect" SET status='REVIEW',error='PASSWORD_SETUP_CONTEXT_MISSING',"updatedAt"=now()
 WHERE kind='INITIAL_SETUP' AND status='PENDING' AND "accountScenario" IS NULL;
-- Older milestone jobs were not created by the new baseline/cutover policy.
UPDATE "OrderTrackingNotification" SET status='CANCELLED',"suppressionReason"='LEGACY_MILESTONE_REVIEW',"updatedAt"=now()
 WHERE category<>'SHIPPED' AND status IN ('PENDING','RETRY');
COMMIT;
