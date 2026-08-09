-- Keep a snapshot under the one-active-checkout constraint while its
-- server-owned PaymentIntent is being safely cancelled and released.
DROP INDEX IF EXISTS "CheckoutSnapshot_active_cart_key";

CREATE UNIQUE INDEX "CheckoutSnapshot_active_cart_key"
  ON "CheckoutSnapshot"("userId", "cartId")
  WHERE "orderId" IS NULL
    AND "status" IN (
      'RESERVED',
      'PAYMENT_INTENT_CREATING',
      'PAYMENT_BOUND',
      'REPLACEMENT_PENDING',
      'DISPUTED'
    );
