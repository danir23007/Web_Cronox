-- Preserve every website media upload as a reusable library asset.
CREATE TABLE "WebsiteMediaAsset" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "folderKey" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteMediaAsset_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WebsiteMediaPlacement" ADD COLUMN "assetId" TEXT;

CREATE UNIQUE INDEX "WebsiteMediaAsset_storageKey_key" ON "WebsiteMediaAsset"("storageKey");
CREATE INDEX "WebsiteMediaAsset_folderKey_mediaType_createdAt_idx" ON "WebsiteMediaAsset"("folderKey", "mediaType", "createdAt");
CREATE INDEX "WebsiteMediaAsset_createdAt_idx" ON "WebsiteMediaAsset"("createdAt");
CREATE INDEX "WebsiteMediaPlacement_assetId_idx" ON "WebsiteMediaPlacement"("assetId");

ALTER TABLE "WebsiteMediaPlacement"
ADD CONSTRAINT "WebsiteMediaPlacement_assetId_fkey"
FOREIGN KEY ("assetId") REFERENCES "WebsiteMediaAsset"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
