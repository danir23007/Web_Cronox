-- Additive: retain the existing Order identity, tracking number and fulfillment state.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
ALTER TABLE "Order"
  ADD COLUMN "trackingRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trackingLastSuccessAt" TIMESTAMP(3),
  ADD COLUMN "trackingLastErrorCode" TEXT,
  ADD COLUMN "trackingLastErrorAt" TIMESTAMP(3),
  ADD COLUMN "trackingNextSyncAt" TIMESTAMP(3),
  ADD COLUMN "trackingLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "trackingLeaseToken" TEXT,
  ADD COLUMN "trackingFailures" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "trackingState" TEXT,
  ADD COLUMN "trackingStateCode" TEXT,
  ADD COLUMN "trackingTerminalAt" TIMESTAMP(3),
  ADD COLUMN "trackingBaselineEstablished" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Order_trackingNextSyncAt_trackingLeaseUntil_idx" ON "Order"("trackingNextSyncAt", "trackingLeaseUntil");

CREATE TABLE "OrderTrackingEvent" (
  "id" TEXT NOT NULL, "orderId" INTEGER NOT NULL, "revision" INTEGER NOT NULL,
  "fingerprint" TEXT NOT NULL, "eventTime" TIMESTAMPTZ(3),
  "eventLocalDate" TEXT, "eventSortKey" TEXT,
  "code" TEXT, "label" TEXT, "category" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderTrackingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderTrackingEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderTrackingEvent_orderId_revision_fingerprint_key" ON "OrderTrackingEvent"("orderId", "revision", "fingerprint");
CREATE INDEX "OrderTrackingEvent_orderId_revision_eventTime_idx" ON "OrderTrackingEvent"("orderId", "revision", "eventTime");
CREATE INDEX "OrderTrackingEvent_orderId_revision_eventSortKey_idx" ON "OrderTrackingEvent"("orderId", "revision", "eventSortKey");

CREATE TABLE "OrderTrackingAudit" (
  "id" TEXT NOT NULL, "orderId" INTEGER NOT NULL, "actorId" INTEGER,
  "actorIdentityUid" UUID,
  "previousNumber" TEXT, "nextNumber" TEXT, "revision" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderTrackingAudit_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderTrackingAudit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderTrackingAudit_orderId_createdAt_idx" ON "OrderTrackingAudit"("orderId", "createdAt");

CREATE TABLE "OrderTrackingNotification" (
  "id" TEXT NOT NULL, "orderId" INTEGER NOT NULL, "revision" INTEGER NOT NULL,
  "eventId" TEXT NOT NULL, "category" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "messageId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "OrderTrackingNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderTrackingNotification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderTrackingNotification_eventId_key" ON "OrderTrackingNotification"("eventId");
CREATE INDEX "OrderTrackingNotification_status_nextAttemptAt_idx" ON "OrderTrackingNotification"("status", "nextAttemptAt");
CREATE INDEX "OrderTrackingNotification_orderId_revision_idx" ON "OrderTrackingNotification"("orderId", "revision");

CREATE TABLE "OrderShippingLabel" (
  "orderId" INTEGER NOT NULL, "storageKey" TEXT NOT NULL,
  "trackingRevision" INTEGER NOT NULL DEFAULT 0,
  "originalName" TEXT NOT NULL, "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL, "uploadedBy" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderShippingLabel_pkey" PRIMARY KEY ("orderId"),
  CONSTRAINT "OrderShippingLabel_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderShippingLabel_storageKey_key" ON "OrderShippingLabel"("storageKey");

CREATE TABLE "CorreosTrackingGate" (
  "key" TEXT NOT NULL,
  "notBefore" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "CorreosTrackingGate_pkey" PRIMARY KEY ("key")
);

-- Private carrier/customer audit and file metadata are available only through
-- the authenticated backend, never Supabase's anonymous/authenticated Data API.
DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['OrderTrackingEvent','OrderTrackingAudit','OrderTrackingNotification','OrderShippingLabel','CorreosTrackingGate'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Existing assigned parcels receive one baseline query, without backfilling emails.
UPDATE "Order" SET "trackingNextSyncAt" = CURRENT_TIMESTAMP
WHERE NULLIF(BTRIM("trackingNumber"), '') IS NOT NULL
  AND LOWER(COALESCE("shippingCarrier", 'correos')) IN ('correos', '')
  AND "status" NOT IN ('CANCELLED', 'REFUNDED');

COMMIT;
