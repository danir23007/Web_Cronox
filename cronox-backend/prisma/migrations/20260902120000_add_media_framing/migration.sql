-- CreateEnum
CREATE TYPE "MediaFitMode" AS ENUM ('COVER', 'CONTAIN');

-- AlterTable
ALTER TABLE "GallerySlot"
ADD COLUMN "fit" "MediaFitMode" NOT NULL DEFAULT 'COVER',
ADD COLUMN "tabletFocalX" DOUBLE PRECISION,
ADD COLUMN "tabletFocalY" DOUBLE PRECISION,
ADD COLUMN "tabletZoom" DOUBLE PRECISION,
ADD COLUMN "tabletFit" "MediaFitMode",
ADD COLUMN "mobileFocalX" DOUBLE PRECISION,
ADD COLUMN "mobileFocalY" DOUBLE PRECISION,
ADD COLUMN "mobileZoom" DOUBLE PRECISION,
ADD COLUMN "mobileFit" "MediaFitMode",
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WebsiteMediaPlacement" (
    "key" TEXT NOT NULL,
    "focalX" DOUBLE PRECISION NOT NULL,
    "focalY" DOUBLE PRECISION NOT NULL,
    "zoom" DOUBLE PRECISION NOT NULL,
    "fit" "MediaFitMode" NOT NULL,
    "tabletFocalX" DOUBLE PRECISION,
    "tabletFocalY" DOUBLE PRECISION,
    "tabletZoom" DOUBLE PRECISION,
    "tabletFit" "MediaFitMode",
    "mobileFocalX" DOUBLE PRECISION,
    "mobileFocalY" DOUBLE PRECISION,
    "mobileZoom" DOUBLE PRECISION,
    "mobileFit" "MediaFitMode",
    "revision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteMediaPlacement_pkey" PRIMARY KEY ("key")
);
