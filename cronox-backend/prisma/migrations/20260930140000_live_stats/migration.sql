CREATE TABLE "LivePresence" (
  "visitorHash" VARCHAR(64) PRIMARY KEY,
  "userId" INTEGER,
  "sessionId" TEXT,
  "anonymousId" TEXT,
  "section" VARCHAR(12) NOT NULL CHECK ("section" IN ('home','store','product','cart','checkout','other')),
  "productId" INTEGER,
  "seenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "LivePresence_seenAt_idx" ON "LivePresence" ("seenAt");
ALTER TABLE "LivePresence" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "LivePresence" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "LivePresence" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "LivePresence" FROM authenticated; END IF;
END $$;
-- Null means unknown; never infer a live/processing payment from creation alone.
ALTER TABLE "CheckoutSnapshot" ADD COLUMN "paymentStatus" TEXT,
  ADD COLUMN "paymentStatusAt" TIMESTAMPTZ(3), ADD COLUMN "paymentLiveMode" BOOLEAN;
CREATE INDEX "CheckoutSnapshot_live_payment_idx" ON "CheckoutSnapshot" ("paymentStatus", "expiresAt") WHERE "paymentLiveMode"=true AND "orderId" IS NULL;
CREATE INDEX "Order_paidAt_live_idx" ON "Order" ("paidAt") WHERE "paidAt" IS NOT NULL;
