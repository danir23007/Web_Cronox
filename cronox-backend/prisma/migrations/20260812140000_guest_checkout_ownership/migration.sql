-- Guest checkout ownership builds on the existing opaque HttpOnly cart UUID.
-- Existing authenticated rows are backfilled before contact email is required.
ALTER TABLE "CheckoutSnapshot"
  ADD COLUMN "anonymousId" TEXT,
  ADD COLUMN "customerEmail" TEXT;

UPDATE "CheckoutSnapshot" AS snapshot
SET "customerEmail" = "User"."email"
FROM "User"
WHERE snapshot."userId" = "User"."id";

ALTER TABLE "CheckoutSnapshot"
  ALTER COLUMN "customerEmail" SET NOT NULL,
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "Order"
  ADD COLUMN "customerEmail" TEXT;

UPDATE "Order" AS customer_order
SET "customerEmail" = "User"."email"
FROM "User"
WHERE customer_order."userId" = "User"."id";

ALTER TABLE "Order"
  ALTER COLUMN "customerEmail" SET NOT NULL,
  ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "CheckoutSnapshot"
  ADD CONSTRAINT "CheckoutSnapshot_exactly_one_owner_check"
  CHECK (
    (CASE WHEN "userId" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "anonymousId" IS NULL THEN 0 ELSE 1 END) = 1
  );

CREATE INDEX "CheckoutSnapshot_anonymousId_status_idx"
  ON "CheckoutSnapshot"("anonymousId", "status");

-- One active payment lifecycle per server-owned cart, regardless of whether
-- the owner is a member or an anonymous browser session.
DROP INDEX IF EXISTS "CheckoutSnapshot_active_cart_key";

CREATE UNIQUE INDEX "CheckoutSnapshot_active_cart_key"
  ON "CheckoutSnapshot"("cartId")
  WHERE "orderId" IS NULL
    AND "status" IN (
      'RESERVED',
      'PAYMENT_INTENT_CREATING',
      'PAYMENT_BOUND',
      'REPLACEMENT_PENDING',
      'MISSING_RECOVERY_PENDING',
      'DISPUTED'
    );
