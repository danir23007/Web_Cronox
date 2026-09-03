-- Gallery descriptions and ordered product associations belong to the stored
-- photograph so they follow it when the asset is reused, moved, or swapped.
ALTER TABLE "GalleryAsset"
  ADD COLUMN "description" TEXT;

CREATE TABLE "GalleryAssetProduct" (
  "id" SERIAL NOT NULL,
  "galleryAssetId" TEXT NOT NULL,
  "productId" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryAssetProduct_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GalleryAssetProduct_position_check" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "GalleryAssetProduct_galleryAssetId_productId_key"
  ON "GalleryAssetProduct"("galleryAssetId", "productId");

CREATE UNIQUE INDEX "GalleryAssetProduct_galleryAssetId_position_key"
  ON "GalleryAssetProduct"("galleryAssetId", "position");

CREATE INDEX "GalleryAssetProduct_productId_idx"
  ON "GalleryAssetProduct"("productId");

ALTER TABLE "GalleryAssetProduct"
  ADD CONSTRAINT "GalleryAssetProduct_galleryAssetId_fkey"
  FOREIGN KEY ("galleryAssetId") REFERENCES "GalleryAsset"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GalleryAssetProduct"
  ADD CONSTRAINT "GalleryAssetProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
