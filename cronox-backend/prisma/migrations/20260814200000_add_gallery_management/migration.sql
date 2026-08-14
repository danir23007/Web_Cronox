-- Persistent originals for the Admin "Fotos antiguas" library.
CREATE TYPE "GalleryPlaceholderColor" AS ENUM ('WHITE', 'RED', 'GREY');

CREATE TABLE "GalleryAsset" (
  "id" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "originalFilename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GalleryAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GalleryAsset_fileSize_check" CHECK ("fileSize" > 0),
  CONSTRAINT "GalleryAsset_width_check" CHECK ("width" IS NULL OR "width" > 0),
  CONSTRAINT "GalleryAsset_height_check" CHECK ("height" IS NULL OR "height" > 0)
);

CREATE TABLE "GallerySlot" (
  "key" TEXT NOT NULL,
  "displayOrder" INTEGER NOT NULL,
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "placeholderColor" "GalleryPlaceholderColor" NOT NULL,
  "assetId" TEXT,
  "focalX" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "focalY" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "zoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "altText" TEXT NOT NULL DEFAULT '',
  "instagramUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GallerySlot_pkey" PRIMARY KEY ("key"),
  CONSTRAINT "GallerySlot_displayOrder_check" CHECK ("displayOrder" BETWEEN 0 AND 12),
  CONSTRAINT "GallerySlot_focalX_check" CHECK ("focalX" BETWEEN 0 AND 100),
  CONSTRAINT "GallerySlot_focalY_check" CHECK ("focalY" BETWEEN 0 AND 100),
  CONSTRAINT "GallerySlot_zoom_check" CHECK ("zoom" BETWEEN 1 AND 3)
);

CREATE UNIQUE INDEX "GalleryAsset_storageKey_key" ON "GalleryAsset"("storageKey");
CREATE INDEX "GalleryAsset_createdAt_idx" ON "GalleryAsset"("createdAt");
CREATE UNIQUE INDEX "GallerySlot_displayOrder_key" ON "GallerySlot"("displayOrder");
CREATE INDEX "GallerySlot_assetId_idx" ON "GallerySlot"("assetId");
CREATE UNIQUE INDEX "GallerySlot_one_featured_idx" ON "GallerySlot"("featured") WHERE "featured" = true;

ALTER TABLE "GallerySlot"
  ADD CONSTRAINT "GallerySlot_assetId_fkey"
  FOREIGN KEY ("assetId") REFERENCES "GalleryAsset"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "GallerySlot" (
  "key", "displayOrder", "featured", "placeholderColor", "updatedAt"
) VALUES
  ('featured', 0, true, 'GREY', CURRENT_TIMESTAMP),
  ('slot-01', 1, false, 'WHITE', CURRENT_TIMESTAMP),
  ('slot-02', 2, false, 'RED', CURRENT_TIMESTAMP),
  ('slot-03', 3, false, 'GREY', CURRENT_TIMESTAMP),
  ('slot-04', 4, false, 'WHITE', CURRENT_TIMESTAMP),
  ('slot-05', 5, false, 'GREY', CURRENT_TIMESTAMP),
  ('slot-06', 6, false, 'WHITE', CURRENT_TIMESTAMP),
  ('slot-07', 7, false, 'RED', CURRENT_TIMESTAMP),
  ('slot-08', 8, false, 'GREY', CURRENT_TIMESTAMP),
  ('slot-09', 9, false, 'RED', CURRENT_TIMESTAMP),
  ('slot-10', 10, false, 'GREY', CURRENT_TIMESTAMP),
  ('slot-11', 11, false, 'WHITE', CURRENT_TIMESTAMP),
  ('slot-12', 12, false, 'RED', CURRENT_TIMESTAMP);
