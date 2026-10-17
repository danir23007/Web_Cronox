BEGIN;

ALTER TABLE "StripeWebhookEvent"
  ADD COLUMN "payload" JSONB,
  ADD COLUMN "result" JSONB,
  ADD COLUMN "leaseToken" TEXT,
  ADD COLUMN "leaseUntil" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "StripeWebhookEvent_status_nextAttemptAt_idx" ON "StripeWebhookEvent"("status", "nextAttemptAt");
CREATE INDEX "StripeWebhookEvent_status_leaseUntil_idx" ON "StripeWebhookEvent"("status", "leaseUntil");
CREATE TABLE "CheckoutEffect" (
  "id" TEXT NOT NULL,
  "checkoutSnapshotId" TEXT NOT NULL,
  "orderId" INTEGER NOT NULL,
  "userId" INTEGER,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "result" TEXT,
  "error" TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CheckoutEffect_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CheckoutEffect_checkoutSnapshotId_kind_key" ON "CheckoutEffect"("checkoutSnapshotId", "kind");
CREATE INDEX "CheckoutEffect_status_nextAttemptAt_idx" ON "CheckoutEffect"("status", "nextAttemptAt");

-- Payloads and recovery actions belong to the backend, never the public REST API.
ALTER TABLE "CheckoutEffect" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StripeWebhookEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CheckoutEffect", "StripeWebhookEvent" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "CheckoutEffect", "StripeWebhookEvent" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "CheckoutEffect", "StripeWebhookEvent" FROM authenticated;
  END IF;
END $$;

-- A disputed-before-success order already has paidAt when it first becomes
-- PAID. Its first paid notification must still enter the existing unique outbox.
CREATE OR REPLACE FUNCTION cronox_order_paid_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='PAID' AND NEW."paidAt" IS NOT NULL AND
 (TG_OP='INSERT' OR OLD."paidAt" IS NULL OR OLD.status <> 'PAID') THEN
  PERFORM cronox_enqueue_admin_push('paidOrders',NEW.id::text,
   jsonb_build_object('orderId',NEW.id,'total',NEW.total::text,'currency',NEW.currency),NEW."paidAt");
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;

-- Run the data change after all DDL: existing deferred accounting triggers
-- may queue work on StripeWebhookEvent and forbid subsequent ALTER TABLEs.
-- Historic events need a newly signed redelivery, never a fabricated payload.
UPDATE "StripeWebhookEvent" SET "status" = 'REVIEW', "error" = 'LEGACY_VERIFIED_PAYLOAD_REQUIRED'
 WHERE "status" <> 'PROCESSED';

COMMIT;
