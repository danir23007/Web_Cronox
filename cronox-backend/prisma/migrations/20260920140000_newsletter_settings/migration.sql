CREATE TABLE "NewsletterSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "mediaAssetId" TEXT,
    "desktopFocalX" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "desktopFocalY" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "desktopZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "desktopFit" "MediaFitMode" NOT NULL DEFAULT 'COVER',
    "mobileFocalX" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "mobileFocalY" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "mobileZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "mobileFit" "MediaFitMode" NOT NULL DEFAULT 'COVER',
    "asciiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "asciiOpacity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterSettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NewsletterSettings_mediaAssetId_idx" ON "NewsletterSettings"("mediaAssetId");

ALTER TABLE "NewsletterSettings"
ADD CONSTRAINT "NewsletterSettings_mediaAssetId_fkey"
FOREIGN KEY ("mediaAssetId") REFERENCES "WebsiteMediaAsset"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Newsletter configuration is read through the controlled Nest endpoint.
-- It is not exposed directly through the Supabase Data API.
ALTER TABLE "NewsletterSettings" ENABLE ROW LEVEL SECURITY;
