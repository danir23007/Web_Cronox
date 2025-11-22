-- Add shipping method code field and unique constraint
ALTER TABLE "ShippingMethod" ADD COLUMN "code" TEXT;

UPDATE "ShippingMethod"
SET "code" = CASE
  WHEN LOWER("name") LIKE '%express%' THEN 'EXPRESS'
  WHEN LOWER("name") LIKE '%standard%' THEN 'STANDARD'
  ELSE UPPER("name")
END
WHERE "code" IS NULL;

ALTER TABLE "ShippingMethod" ALTER COLUMN "code" SET NOT NULL;

CREATE UNIQUE INDEX "ShippingMethod_code_key" ON "ShippingMethod"("code");
