CREATE TYPE "KeyScreenMode" AS ENUM ('PREREGISTRATION', 'ACCESS');
CREATE TYPE "KeyScreenControlStyle" AS ENUM ('LIGHT', 'DARK', 'OUTLINE');
CREATE TYPE "KeyScreenHorizontalAlign" AS ENUM ('LEFT', 'CENTER', 'RIGHT');
CREATE TYPE "KeyScreenVerticalAlign" AS ENUM ('TOP', 'CENTER', 'BOTTOM');
CREATE TYPE "UserAccountState" AS ENUM ('ACTIVE', 'PENDING_PASSWORD', 'PRE_REGISTERED');

ALTER TABLE "User" ADD COLUMN "accountState" "UserAccountState" NOT NULL DEFAULT 'ACTIVE';
UPDATE "User" SET "accountState" = 'PENDING_PASSWORD' WHERE "passwordHash" IS NULL;

CREATE TABLE "KeyScreen" (
  "id" TEXT NOT NULL,
  "internalName" TEXT NOT NULL,
  "mode" "KeyScreenMode" NOT NULL DEFAULT 'PREREGISTRATION',
  "mediaAssetId" TEXT,
  "desktopFocalX" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "desktopFocalY" DOUBLE PRECISION NOT NULL DEFAULT 50,
  "desktopZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "desktopFit" "MediaFitMode" NOT NULL DEFAULT 'COVER',
  "mobileFocalX" DOUBLE PRECISION,
  "mobileFocalY" DOUBLE PRECISION,
  "mobileZoom" DOUBLE PRECISION,
  "mobileFit" "MediaFitMode",
  "title" TEXT NOT NULL DEFAULT 'PRÓXIMAMENTE',
  "subtitle" TEXT NOT NULL DEFAULT '',
  "placeholder" TEXT NOT NULL DEFAULT 'Correo electrónico',
  "buttonText" TEXT NOT NULL DEFAULT 'NOTIFICARME',
  "successTitle" TEXT NOT NULL DEFAULT 'YA FORMAS PARTE.',
  "successMessage" TEXT NOT NULL DEFAULT 'Si el correo es válido, ya formas parte.',
  "privacyLabel" TEXT NOT NULL DEFAULT 'Política de privacidad',
  "textColor" TEXT NOT NULL DEFAULT '#ffffff',
  "inputStyle" "KeyScreenControlStyle" NOT NULL DEFAULT 'LIGHT',
  "buttonStyle" "KeyScreenControlStyle" NOT NULL DEFAULT 'DARK',
  "horizontalAlign" "KeyScreenHorizontalAlign" NOT NULL DEFAULT 'CENTER',
  "verticalAlign" "KeyScreenVerticalAlign" NOT NULL DEFAULT 'CENTER',
  "offsetX" INTEGER NOT NULL DEFAULT 0,
  "offsetY" INTEGER NOT NULL DEFAULT 0,
  "overlayStrength" INTEGER NOT NULL DEFAULT 25,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdBy" INTEGER,
  "updatedBy" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyScreen_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeyScreenSettings" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "activeScreenId" TEXT,
  "updatedBy" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyScreenSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PreRegistration" (
  "userId" INTEGER NOT NULL,
  "screenId" TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmationClaimedAt" TIMESTAMP(3),
  "confirmationSentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PreRegistration_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "KeyScreenSettings_activeScreenId_key" ON "KeyScreenSettings"("activeScreenId");
CREATE INDEX "KeyScreen_updatedAt_idx" ON "KeyScreen"("updatedAt");
CREATE INDEX "KeyScreen_mediaAssetId_idx" ON "KeyScreen"("mediaAssetId");
CREATE INDEX "PreRegistration_screenId_submittedAt_idx" ON "PreRegistration"("screenId", "submittedAt");
CREATE INDEX "PreRegistration_submittedAt_idx" ON "PreRegistration"("submittedAt");

ALTER TABLE "KeyScreen" ADD CONSTRAINT "KeyScreen_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "WebsiteMediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KeyScreenSettings" ADD CONSTRAINT "KeyScreenSettings_activeScreenId_fkey" FOREIGN KEY ("activeScreenId") REFERENCES "KeyScreen"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PreRegistration" ADD CONSTRAINT "PreRegistration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PreRegistration" ADD CONSTRAINT "PreRegistration_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "KeyScreen"("id") ON DELETE SET NULL ON UPDATE CASCADE;
