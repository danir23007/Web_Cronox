-- [FIX] Remove dangling foreign key from "Order" to non-existent "User" table and store user ids as text
ALTER TABLE "Order" DROP CONSTRAINT IF EXISTS "Order_userId_fkey";

-- [FIX] Ensure "userId" column stores textual identifiers while preserving data
ALTER TABLE "Order"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::text;

-- [FIX] Index for faster lookups by userId
CREATE INDEX IF NOT EXISTS "Order_userId_idx" ON "Order"("userId");
