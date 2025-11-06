-- Alter enum Role to replace CUSTOMER with USER
ALTER TYPE "Role" RENAME VALUE 'CUSTOMER' TO 'USER';

-- Ensure existing users use the new default role value
UPDATE "User" SET "role" = 'USER' WHERE "role" IS NULL;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';

-- Rename quantity column to delta only if the legacy column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'StockMovement'
      AND column_name = 'quantity'
  ) THEN
    ALTER TABLE "StockMovement" RENAME COLUMN "quantity" TO "delta";
  END IF;
END $$;

-- Allow nullable reasons for stock movements
ALTER TABLE "StockMovement" ALTER COLUMN "reason" DROP NOT NULL;

-- Add userId column with foreign key to User
ALTER TABLE "StockMovement" ADD COLUMN "userId" INTEGER;
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- New indexes for filtering
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx" ON "Order"("createdAt");
CREATE INDEX IF NOT EXISTS "Order_status_idx" ON "Order"("status");
CREATE INDEX IF NOT EXISTS "StockMovement_variantId_createdAt_idx"
  ON "StockMovement"("variantId", "createdAt");
CREATE INDEX IF NOT EXISTS "StockMovement_userId_idx" ON "StockMovement"("userId");
