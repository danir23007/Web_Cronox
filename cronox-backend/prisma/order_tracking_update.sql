-- CRONOX order tracking upgrade (PostgreSQL)
-- Ejecutar manualmente solo si NO usas `prisma db push`.

ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "trackingNumber" TEXT,
  ADD COLUMN IF NOT EXISTS "trackingUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "shippingCarrier" TEXT,
  ADD COLUMN IF NOT EXISTS "shippedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "internalNote" TEXT;
