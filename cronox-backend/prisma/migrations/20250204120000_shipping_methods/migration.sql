-- CreateTable
CREATE TABLE "ShippingMethod" (
  "id" SERIAL NOT NULL,
  "name" TEXT NOT NULL,
  "price" INTEGER NOT NULL,
  "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShippingMethod_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "shippingMethodId" INTEGER;

-- CreateIndex
CREATE INDEX "Order_shippingMethodId_idx" ON "Order"("shippingMethodId");

-- AddForeignKey
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_shippingMethodId_fkey"
  FOREIGN KEY ("shippingMethodId")
  REFERENCES "ShippingMethod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
