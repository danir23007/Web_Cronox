CREATE TYPE "OrderSource" AS ENUM ('ONLINE', 'IN_PERSON_ADMIN');
CREATE TYPE "OrderPaymentMethod" AS ENUM ('STRIPE', 'CASH', 'EXTERNAL_CARD', 'BANK_TRANSFER', 'OTHER');
CREATE TYPE "ManualStockHandling" AS ENUM ('DEDUCT_NOW', 'ALREADY_ADJUSTED');

ALTER TABLE "Order"
  ADD COLUMN "source" "OrderSource" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "paymentMethod" "OrderPaymentMethod",
  ADD COLUMN "purchasedAt" TIMESTAMP(3),
  ADD COLUMN "recordedById" INTEGER,
  ADD COLUMN "manualStockHandling" "ManualStockHandling",
  ADD COLUMN "manualIdempotencyKey" VARCHAR(100),
  ADD COLUMN "manualRequestHash" VARCHAR(64),
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidedById" INTEGER,
  ADD COLUMN "voidReason" VARCHAR(500);

UPDATE "Order"
SET "paymentMethod" = 'STRIPE', "purchasedAt" = "createdAt"
WHERE "provider" = 'stripe';

ALTER TABLE "OrderItem" ADD COLUMN "variantId" INTEGER;

UPDATE "OrderItem" AS oi
SET "variantId" = (
  SELECT csi."variantId"
  FROM "CheckoutSnapshot" cs
  JOIN "CheckoutSnapshotItem" csi ON csi."checkoutSnapshotId" = cs."id"
  WHERE cs."orderId" = oi."orderId"
    AND csi."productId" = oi."productId"
    AND csi."title" = oi."title"
  ORDER BY csi."id"
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM "CheckoutSnapshot" cs
  JOIN "CheckoutSnapshotItem" csi ON csi."checkoutSnapshotId" = cs."id"
  WHERE cs."orderId" = oi."orderId"
    AND csi."productId" = oi."productId"
    AND csi."title" = oi."title"
);

CREATE UNIQUE INDEX "Order_manualIdempotencyKey_key" ON "Order"("manualIdempotencyKey");
CREATE INDEX "Order_source_createdAt_idx" ON "Order"("source", "createdAt");
CREATE INDEX "Order_recordedById_createdAt_idx" ON "Order"("recordedById", "createdAt");
CREATE INDEX "OrderItem_variantId_idx" ON "OrderItem"("variantId");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Order_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Repair the legacy accreditation cache from authoritative order rows. The
-- application now calculates all three figures from Order/OrderItem on read.
INSERT INTO "historial" ("userId", "pedidosRealizados", "articulosAdquiridos", "devoluciones", "createdAt", "updatedAt")
SELECT
  u."id",
  COUNT(DISTINCT o."id") FILTER (WHERE o."status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','DISPUTED','REFUNDED'))::integer,
  COALESCE(SUM(oi."quantity") FILTER (WHERE o."status" IN ('PAID','PROCESSING','SHIPPED','DELIVERED','DISPUTED')), 0)::integer,
  COALESCE(SUM(oi."quantity") FILTER (WHERE o."status" = 'REFUNDED'), 0)::integer,
  NOW(),
  NOW()
FROM "User" u
LEFT JOIN "Order" o ON o."userId" = u."id"
LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
GROUP BY u."id"
ON CONFLICT ("userId") DO UPDATE SET
  "pedidosRealizados" = EXCLUDED."pedidosRealizados",
  "articulosAdquiridos" = EXCLUDED."articulosAdquiridos",
  "devoluciones" = EXCLUDED."devoluciones",
  "updatedAt" = NOW();
