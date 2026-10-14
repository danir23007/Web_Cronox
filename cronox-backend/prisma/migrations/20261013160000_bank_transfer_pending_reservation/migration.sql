-- A bank order stays active while awaiting funds. Prevent another snapshot for
-- the same cart even though the pending order already has an orderId.
DROP INDEX "CheckoutSnapshot_active_cart_key";
CREATE UNIQUE INDEX "CheckoutSnapshot_active_cart_key"
  ON "CheckoutSnapshot"("cartId")
  WHERE ("orderId" IS NULL OR "status" = 'BANK_TRANSFER_PENDING')
    AND "status" IN ('RESERVED', 'PAYMENT_INTENT_CREATING', 'PAYMENT_BOUND',
      'REPLACEMENT_PENDING', 'MISSING_RECOVERY_PENDING', 'DISPUTED', 'BANK_TRANSFER_PENDING');
