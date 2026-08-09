-- Persist an immutable checkout record before creating a PaymentIntent.
-- This migration intentionally uses strings for internal workflow states so
-- lifecycle handling can be extended without changing a database enum.

CREATE TABLE "CheckoutSnapshot" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "cartId" INTEGER NOT NULL,
    "cartUpdatedAt" TIMESTAMP(3) NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "subtotalCents" INTEGER NOT NULL,
    "taxRate" DECIMAL(5,4) NOT NULL,
    "taxAmountCents" INTEGER NOT NULL,
    "shippingCostCents" INTEGER NOT NULL DEFAULT 0,
    "shippingMethodId" INTEGER,
    "shippingMethodCode" TEXT,
    "shippingMethodLabel" TEXT,
    "shippingMethodDescription" TEXT,
    "shippingMethodPriceCents" INTEGER,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "disputeLostCents" INTEGER NOT NULL DEFAULT 0,
    "promoCodeId" INTEGER,
    "promoCodeCode" TEXT,
    "totalCents" INTEGER NOT NULL,
    "shippingAddr" JSONB,
    "billingAddr" JSONB,
    "confirmationEmailSentAt" TIMESTAMP(3),
    "confirmationEmailClaimedAt" TIMESTAMP(3),
    "stockReturnedAt" TIMESTAMP(3),
    "orderId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CheckoutSnapshotItem" (
    "id" SERIAL NOT NULL,
    "checkoutSnapshotId" TEXT NOT NULL,
    "productId" INTEGER NOT NULL,
    "variantId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "CheckoutSnapshotItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CheckoutStockReservation" (
    "id" TEXT NOT NULL,
    "checkoutSnapshotId" TEXT NOT NULL,
    "variantId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "releasedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CheckoutStockReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StripeWebhookEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "lifecycleStatus" TEXT,
    "amountCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "error" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CheckoutSnapshot_stripePaymentIntentId_key" ON "CheckoutSnapshot"("stripePaymentIntentId");
CREATE UNIQUE INDEX "CheckoutSnapshot_orderId_key" ON "CheckoutSnapshot"("orderId");
CREATE INDEX "CheckoutSnapshot_userId_status_idx" ON "CheckoutSnapshot"("userId", "status");
CREATE INDEX "CheckoutSnapshot_cartId_idx" ON "CheckoutSnapshot"("cartId");
CREATE INDEX "CheckoutSnapshot_expiresAt_idx" ON "CheckoutSnapshot"("expiresAt");
CREATE INDEX "CheckoutSnapshot_userId_cartId_cartUpdatedAt_requestFingerprint_idx" ON "CheckoutSnapshot"("userId", "cartId", "cartUpdatedAt", "requestFingerprint");
CREATE UNIQUE INDEX "CheckoutSnapshot_active_cart_key"
  ON "CheckoutSnapshot"("userId", "cartId")
  WHERE "orderId" IS NULL
    AND "status" IN ('RESERVED', 'PAYMENT_INTENT_CREATING', 'PAYMENT_BOUND', 'DISPUTED');
CREATE INDEX "CheckoutSnapshotItem_checkoutSnapshotId_idx" ON "CheckoutSnapshotItem"("checkoutSnapshotId");
CREATE INDEX "CheckoutSnapshotItem_variantId_idx" ON "CheckoutSnapshotItem"("variantId");
CREATE UNIQUE INDEX "CheckoutStockReservation_checkoutSnapshotId_variantId_key" ON "CheckoutStockReservation"("checkoutSnapshotId", "variantId");
CREATE INDEX "CheckoutStockReservation_variantId_status_idx" ON "CheckoutStockReservation"("variantId", "status");
CREATE INDEX "CheckoutStockReservation_checkoutSnapshotId_status_idx" ON "CheckoutStockReservation"("checkoutSnapshotId", "status");
CREATE INDEX "StripeWebhookEvent_paymentIntentId_occurredAt_idx" ON "StripeWebhookEvent"("paymentIntentId", "occurredAt");
CREATE INDEX "StripeWebhookEvent_status_updatedAt_idx" ON "StripeWebhookEvent"("status", "updatedAt");

ALTER TABLE "StockMovement" ADD COLUMN "checkoutSnapshotId" TEXT;
CREATE INDEX "StockMovement_checkoutSnapshotId_idx" ON "StockMovement"("checkoutSnapshotId");

ALTER TABLE "Order" ADD COLUMN "preDisputeStatus" "OrderStatus";
ALTER TABLE "Order" ADD COLUMN "disputeLostCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "CheckoutSnapshot"
  ADD CONSTRAINT "CheckoutSnapshot_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CheckoutSnapshot"
  ADD CONSTRAINT "CheckoutSnapshot_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CheckoutSnapshotItem"
  ADD CONSTRAINT "CheckoutSnapshotItem_checkoutSnapshotId_fkey"
  FOREIGN KEY ("checkoutSnapshotId") REFERENCES "CheckoutSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckoutStockReservation"
  ADD CONSTRAINT "CheckoutStockReservation_checkoutSnapshotId_fkey"
  FOREIGN KEY ("checkoutSnapshotId") REFERENCES "CheckoutSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CheckoutStockReservation"
  ADD CONSTRAINT "CheckoutStockReservation_variantId_fkey"
  FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_checkoutSnapshotId_fkey"
  FOREIGN KEY ("checkoutSnapshotId") REFERENCES "CheckoutSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';
