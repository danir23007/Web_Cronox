BEGIN;
ALTER TABLE "NewsletterSubscription"
  ADD COLUMN "subscribedAt" TIMESTAMP(3),
  ADD COLUMN "welcomePromoCodeId" INTEGER,
  ADD COLUMN "welcomeSentAt" TIMESTAMP(3),
  ADD COLUMN "welcomeClaimedAt" TIMESTAMP(3);
ALTER TABLE "PromoCode" ADD COLUMN "firstOrderOnly" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "NewsletterSubscription_welcomePromoCodeId_key" ON "NewsletterSubscription"("welcomePromoCodeId");
ALTER TABLE "NewsletterSubscription" ADD CONSTRAINT "NewsletterSubscription_welcomePromoCodeId_fkey"
  FOREIGN KEY ("welcomePromoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve confirmed consent. Pending legacy addresses are NOT opted in by migration.
UPDATE "NewsletterSubscription" SET "subscribedAt" = "verifiedAt" WHERE "verifiedAt" IS NOT NULL;

-- Previously issued welcome codes lived in a table checkout never consulted.
-- Keep their exact strings and used state; do not generate replacement codes.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "DiscountCode" d JOIN "User" u ON u.id = d."userId"
    JOIN "PromoCode" p ON p.code = d.code
    WHERE d.type = 'FIRST_ORDER' AND (lower(p."ownerEmail") IS DISTINCT FROM lower(u.email)
      OR p.value <> d.percent OR p.type <> 'PERCENT')) THEN
    RAISE EXCEPTION 'Legacy welcome code collision requires manual review';
  END IF;
END $$;
INSERT INTO "PromoCode" (code, type, value, "ownerEmail", "usageLimit", "singleUsePerUser", "firstOrderOnly", "usageCount", "isActive", "createdAt", "updatedAt")
SELECT d.code, 'PERCENT', d.percent, lower(u.email), 1, true, true,
  CASE WHEN d.used THEN 1 ELSE 0 END, NOT d.used, d."createdAt", CURRENT_TIMESTAMP
FROM "DiscountCode" d JOIN "User" u ON u.id = d."userId"
WHERE d.type = 'FIRST_ORDER' AND NOT EXISTS (SELECT 1 FROM "PromoCode" p WHERE p.code = d.code);
UPDATE "NewsletterSubscription" s SET "welcomePromoCodeId" = p.id
FROM "PromoCode" p WHERE p."firstOrderOnly" = true AND p."ownerEmail" = s.email
  AND p.id = (SELECT max(p2.id) FROM "PromoCode" p2 WHERE p2."firstOrderOnly" = true AND p2."ownerEmail" = s.email);

CREATE TABLE "EmailDelivery" (
  "id" TEXT NOT NULL,
  "senderKey" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "purpose" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "providerMessageId" TEXT,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailDelivery_createdAt_id_idx" ON "EmailDelivery"("createdAt", "id");
CREATE INDEX "EmailDelivery_senderKey_createdAt_idx" ON "EmailDelivery"("senderKey", "createdAt");
ALTER TABLE "EmailDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "EmailDelivery" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "EmailDelivery" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "EmailDelivery" FROM authenticated; END IF;
END $$;
COMMIT;
