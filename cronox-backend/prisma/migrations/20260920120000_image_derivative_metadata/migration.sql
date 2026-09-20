ALTER TABLE "ProductImage"
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "fileSize" INTEGER,
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "variants" JSONB;

ALTER TABLE "GalleryAsset" ADD COLUMN "variants" JSONB;
ALTER TABLE "WebsiteMediaAsset" ADD COLUMN "variants" JSONB;
