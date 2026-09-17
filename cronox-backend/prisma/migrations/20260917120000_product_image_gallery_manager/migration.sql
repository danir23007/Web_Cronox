ALTER TABLE "ProductImage"
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "galleryPositionX" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN "galleryPositionY" DOUBLE PRECISION NOT NULL DEFAULT 50,
ADD COLUMN "galleryZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "galleryFit" TEXT NOT NULL DEFAULT 'CONTAIN',
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "deletionState" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ProductImage"
ADD CONSTRAINT "ProductImage_galleryPositionX_check" CHECK ("galleryPositionX" BETWEEN 0 AND 100),
ADD CONSTRAINT "ProductImage_galleryPositionY_check" CHECK ("galleryPositionY" BETWEEN 0 AND 100),
ADD CONSTRAINT "ProductImage_galleryZoom_check" CHECK ("galleryZoom" BETWEEN 0.5 AND 3),
ADD CONSTRAINT "ProductImage_galleryFit_check" CHECK ("galleryFit" IN ('CONTAIN', 'COVER')),
ADD CONSTRAINT "ProductImage_deletionState_check" CHECK ("deletionState" IS NULL OR ("deletionState" = 'PENDING' AND NOT "isActive")),
ADD CONSTRAINT "ProductImage_active_primary_check" CHECK (NOT "isPrimary" OR "isActive");

CREATE INDEX "ProductImage_productId_isActive_sortOrder_idx"
ON "ProductImage"("productId", "isActive", "sortOrder");

CREATE INDEX "ProductImage_url_idx" ON "ProductImage"("url");

-- Canonicalize legacy rows deterministically: an existing primary wins, then
-- sortOrder/id. This also repairs old products with zero or several primaries.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "productId"
           ORDER BY "isPrimary" DESC, "sortOrder" ASC, "id" ASC
         ) AS position
  FROM "ProductImage"
)
UPDATE "ProductImage" AS image
SET "isPrimary" = ranked.position = 1,
    "sortOrder" = ranked.position - 1
FROM ranked
WHERE image."id" = ranked."id";

CREATE UNIQUE INDEX "ProductImage_one_active_primary_per_product"
ON "ProductImage"("productId")
WHERE "isActive" = true AND "isPrimary" = true;
