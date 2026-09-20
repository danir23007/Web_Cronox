CREATE TYPE "GalleryPresentationMode" AS ENUM ('MOSAIC', 'CAROUSEL');

CREATE TABLE "GallerySettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "activeMode" "GalleryPresentationMode" NOT NULL DEFAULT 'MOSAIC',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GallerySettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GallerySettings_global_id_check" CHECK ("id" = 'global')
);

CREATE TABLE "GalleryCarouselSlot" (
    "position" INTEGER NOT NULL,
    "assetId" TEXT,
    "focalX" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "focalY" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "zoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "fit" "MediaFitMode" NOT NULL DEFAULT 'COVER',
    "tabletFocalX" DOUBLE PRECISION,
    "tabletFocalY" DOUBLE PRECISION,
    "tabletZoom" DOUBLE PRECISION,
    "tabletFit" "MediaFitMode",
    "mobileFocalX" DOUBLE PRECISION,
    "mobileFocalY" DOUBLE PRECISION,
    "mobileZoom" DOUBLE PRECISION,
    "mobileFit" "MediaFitMode",
    "revision" INTEGER NOT NULL DEFAULT 0,
    "altText" TEXT NOT NULL DEFAULT '',
    "instagramUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GalleryCarouselSlot_pkey" PRIMARY KEY ("position"),
    CONSTRAINT "GalleryCarouselSlot_position_check" CHECK ("position" BETWEEN 1 AND 5),
    CONSTRAINT "GalleryCarouselSlot_focalX_check" CHECK ("focalX" BETWEEN 0 AND 100),
    CONSTRAINT "GalleryCarouselSlot_focalY_check" CHECK ("focalY" BETWEEN 0 AND 100),
    CONSTRAINT "GalleryCarouselSlot_zoom_check" CHECK ("zoom" BETWEEN 1 AND 3),
    CONSTRAINT "GalleryCarouselSlot_tablet_frame_check" CHECK (
      ("tabletFocalX" IS NULL AND "tabletFocalY" IS NULL AND "tabletZoom" IS NULL AND "tabletFit" IS NULL)
      OR ("tabletFocalX" BETWEEN 0 AND 100 AND "tabletFocalY" BETWEEN 0 AND 100 AND "tabletZoom" BETWEEN 1 AND 3 AND "tabletFit" IS NOT NULL)
    ),
    CONSTRAINT "GalleryCarouselSlot_mobile_frame_check" CHECK (
      ("mobileFocalX" IS NULL AND "mobileFocalY" IS NULL AND "mobileZoom" IS NULL AND "mobileFit" IS NULL)
      OR ("mobileFocalX" BETWEEN 0 AND 100 AND "mobileFocalY" BETWEEN 0 AND 100 AND "mobileZoom" BETWEEN 1 AND 3 AND "mobileFit" IS NOT NULL)
    )
);

CREATE INDEX "GalleryCarouselSlot_assetId_idx" ON "GalleryCarouselSlot"("assetId");

ALTER TABLE "GalleryCarouselSlot"
ADD CONSTRAINT "GalleryCarouselSlot_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "GalleryAsset"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Gallery configuration is exposed only through controlled Nest endpoints.
ALTER TABLE "GallerySettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GalleryCarouselSlot" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "GallerySettings" FROM anon, authenticated;
REVOKE ALL ON TABLE "GalleryCarouselSlot" FROM anon, authenticated;
