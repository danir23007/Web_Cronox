ALTER TABLE "PreRegistration"
  ADD COLUMN "launchCode" TEXT,
  ADD COLUMN "launchTokenHash" TEXT,
  ADD COLUMN "launchTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN "launchTokenUsedAt" TIMESTAMP(3),
  ADD COLUMN "launchClaimedAt" TIMESTAMP(3),
  ADD COLUMN "launchSentAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "PreRegistration_launchCode_key" ON "PreRegistration"("launchCode");
CREATE UNIQUE INDEX "PreRegistration_launchTokenHash_key" ON "PreRegistration"("launchTokenHash");
ALTER TABLE "PromoCode" ADD COLUMN "ownerUserId" INTEGER, ADD COLUMN "ownerEmail" TEXT;
CREATE TABLE "ArchivedCheckoutPayment" (
  "paymentIntentId" TEXT PRIMARY KEY,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "ArchivedCheckoutPayment" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ArchivedCheckoutPayment" FROM anon, authenticated;
