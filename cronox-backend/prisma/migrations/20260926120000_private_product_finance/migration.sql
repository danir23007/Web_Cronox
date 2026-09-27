BEGIN;
-- Additive only. Deliberately no cost backfill: today's cost is not historical evidence.
-- AlterTable
ALTER TABLE "StripeWebhookEvent" ADD COLUMN     "refundCumulativeCents" INTEGER;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ProductCost" (
    "productId" INTEGER NOT NULL,
    "unitCostCents" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductCost_pkey" PRIMARY KEY ("productId")
);

-- CreateTable
CREATE TABLE "CheckoutItemFinancial" (
    "itemId" INTEGER NOT NULL,
    "unitCostCents" INTEGER,
    "productName" TEXT NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "CheckoutItemFinancial_pkey" PRIMARY KEY ("itemId")
);

-- CreateTable
CREATE TABLE "OrderItemFinancial" (
    "itemId" INTEGER NOT NULL,
    "unitCostCents" INTEGER,
    "productName" TEXT NOT NULL,
    "imageUrl" TEXT,

    CONSTRAINT "OrderItemFinancial_pkey" PRIMARY KEY ("itemId")
);

-- AddForeignKey
ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckoutItemFinancial" ADD CONSTRAINT "CheckoutItemFinancial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CheckoutSnapshotItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItemFinancial" ADD CONSTRAINT "OrderItemFinancial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductCost" ADD CONSTRAINT "ProductCost_nonnegative" CHECK ("unitCostCents" >= 0);
ALTER TABLE "CheckoutItemFinancial" ADD CONSTRAINT "CheckoutItemFinancial_nonnegative" CHECK ("unitCostCents" >= 0);
ALTER TABLE "OrderItemFinancial" ADD CONSTRAINT "OrderItemFinancial_nonnegative" CHECK ("unitCostCents" >= 0);
ALTER TABLE "StripeWebhookEvent" ADD CONSTRAINT "StripeWebhookEvent_refund_nonnegative" CHECK ("refundCumulativeCents" >= 0);

-- Only the server database role may access internal costs, including via Supabase REST.
ALTER TABLE "ProductCost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CheckoutItemFinancial" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OrderItemFinancial" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ProductCost", "CheckoutItemFinancial", "OrderItemFinancial" FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON "ProductCost", "CheckoutItemFinancial", "OrderItemFinancial" FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
COMMIT;
