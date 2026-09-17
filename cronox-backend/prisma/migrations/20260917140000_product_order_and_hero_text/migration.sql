-- Product order is initialized to the catalogue's previous default (id ASC).
-- ROW_NUMBER makes the values compact and deterministic without assuming IDs
-- are contiguous.
ALTER TABLE "Product" ADD COLUMN "displayOrder" INTEGER;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id ASC) - 1 AS position
  FROM "Product"
)
UPDATE "Product" AS product
SET "displayOrder" = ranked.position
FROM ranked
WHERE product.id = ranked.id;

ALTER TABLE "Product" ALTER COLUMN "displayOrder" SET NOT NULL;
ALTER TABLE "Product" ALTER COLUMN "displayOrder" SET DEFAULT 0;
CREATE INDEX "Product_displayOrder_id_idx" ON "Product"("displayOrder", "id");

-- The nullable/disabled defaults deliberately remove the former hard-coded
-- homepage copy. Existing media framing remains untouched.
ALTER TABLE "WebsiteMediaPlacement"
  ADD COLUMN "heroText" TEXT,
  ADD COLUMN "heroTextEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "heroTextX" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN "heroTextY" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN "heroTextMobileX" DOUBLE PRECISION,
  ADD COLUMN "heroTextMobileY" DOUBLE PRECISION,
  ADD COLUMN "heroTextAlign" TEXT NOT NULL DEFAULT 'CENTER',
  ADD COLUMN "heroTextColor" TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN "heroTextFontSize" INTEGER NOT NULL DEFAULT 42,
  ADD COLUMN "heroTextMobileFontSize" INTEGER,
  ADD COLUMN "heroTextFontWeight" INTEGER NOT NULL DEFAULT 800,
  ADD COLUMN "heroTextLetterSpacing" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  ADD COLUMN "heroTextUppercase" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "heroTextMaxWidth" INTEGER NOT NULL DEFAULT 90;
