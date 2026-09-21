-- Carousel content belongs to the carousel selection, not to a shared GalleryAsset.
ALTER TABLE "GalleryCarouselSlot"
  ADD COLUMN "itemId" TEXT,
  ADD COLUMN "description" TEXT,
  ADD COLUMN "relatedProductIds" JSONB;

-- Preserve existing images and their positions; give each occupied selection a
-- stable identity without copying shared mosaic metadata into the carousel.
UPDATE "GalleryCarouselSlot"
SET "itemId" = md5(random()::text || clock_timestamp()::text || "position"::text),
    "relatedProductIds" = '[]'::jsonb
WHERE "assetId" IS NOT NULL;

CREATE UNIQUE INDEX "GalleryCarouselSlot_itemId_key" ON "GalleryCarouselSlot"("itemId");

ALTER TABLE "GalleryCarouselSlot"
  ADD CONSTRAINT "GalleryCarouselSlot_item_content_check" CHECK (
    ("assetId" IS NULL OR "itemId" IS NOT NULL)
    AND ("relatedProductIds" IS NULL OR jsonb_typeof("relatedProductIds") = 'array')
  );
