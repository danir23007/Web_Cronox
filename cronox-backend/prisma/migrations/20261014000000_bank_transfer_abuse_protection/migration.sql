ALTER TABLE "CheckoutSnapshot" ADD COLUMN "bankNetworkHash" TEXT,
  ADD COLUMN "bankAddressHash" TEXT,
  ADD COLUMN "bankRequestedAt" TIMESTAMPTZ(3);
CREATE INDEX "CheckoutSnapshot_bankNetworkHash_bankRequestedAt_idx" ON "CheckoutSnapshot"("bankNetworkHash", "bankRequestedAt");
CREATE INDEX "CheckoutSnapshot_bankAddressHash_bankRequestedAt_idx" ON "CheckoutSnapshot"("bankAddressHash", "bankRequestedAt");
CREATE INDEX "CheckoutSnapshot_customerEmail_bankRequestedAt_idx" ON "CheckoutSnapshot"("customerEmail", "bankRequestedAt");
