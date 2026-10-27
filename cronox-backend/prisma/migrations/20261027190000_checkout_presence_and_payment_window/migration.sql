ALTER TABLE "CheckoutSnapshot"
  ADD COLUMN "reservationPhase" TEXT NOT NULL DEFAULT 'PRESENCE',
  ADD COLUMN "paymentStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "stripeCreateRequest" JSONB,
  ADD COLUMN "reservationRetryAt" TIMESTAMPTZ(3);

CREATE TABLE "CheckoutPresence" (
  "cartId" INTEGER NOT NULL,
  "tabId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "departedAt" TIMESTAMPTZ(3),
  PRIMARY KEY ("cartId", "tabId")
);
CREATE INDEX "CheckoutPresence_expiresAt_idx" ON "CheckoutPresence"("expiresAt");

-- Existing potentially chargeable attempts must not become renewable presence.
-- Keep their original deadline for migration safety; no new attempt gets this
-- legacy duration. Operators reconcile the bounded legacy cohort separately.
UPDATE "CheckoutSnapshot" SET "reservationPhase" = 'PROTECTED',
  "paymentStartedAt" = COALESCE("bankRequestedAt", "createdAt")
WHERE "stripePaymentIntentId" IS NOT NULL
  AND "status" IN ('PAYMENT_BOUND', 'BANK_TRANSFER_PENDING', 'REPLACEMENT_PENDING', 'MISSING_RECOVERY_PENDING');
-- Unbound historical holds have no browser presence. The worker reconciles
-- them on startup. Unknown in-flight creations are retained for review.
UPDATE "CheckoutSnapshot" SET "expiresAt" = LEAST("expiresAt", CURRENT_TIMESTAMP)
WHERE "stripePaymentIntentId" IS NULL AND "status" IN ('RESERVED', 'PAYMENT_INTENT_CREATING');
