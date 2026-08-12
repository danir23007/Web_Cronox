-- Persist the Stripe account that created each PaymentIntent so a later
-- resource_missing response can be distinguished from an account/key switch.
ALTER TABLE "CheckoutSnapshot"
  ADD COLUMN "stripeAccountId" TEXT,
  ADD COLUMN "paymentRecoveryToken" TEXT,
  ADD COLUMN "paymentRecoveryClaimedAt" TIMESTAMP(3);

CREATE INDEX "CheckoutSnapshot_stripeAccountId_stripePaymentIntentId_idx"
  ON "CheckoutSnapshot"("stripeAccountId", "stripePaymentIntentId");

-- A recovery claim remains the sole active snapshot for its cart. This keeps
-- replacement creation behind the existing database uniqueness invariant.
DROP INDEX IF EXISTS "CheckoutSnapshot_active_cart_key";

CREATE UNIQUE INDEX "CheckoutSnapshot_active_cart_key"
  ON "CheckoutSnapshot"("userId", "cartId")
  WHERE "orderId" IS NULL
    AND "status" IN (
      'RESERVED',
      'PAYMENT_INTENT_CREATING',
      'PAYMENT_BOUND',
      'REPLACEMENT_PENDING',
      'MISSING_RECOVERY_PENDING',
      'DISPUTED'
    );
