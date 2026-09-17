-- Add complete, independent tablet and mobile hero-text presentation settings.
-- Existing desktop values seed tablet. Existing mobile position/font-size
-- overrides are preserved while the remaining mobile styles seed from desktop.
ALTER TABLE "WebsiteMediaPlacement"
  ADD COLUMN "heroTextTabletX" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN "heroTextTabletY" DOUBLE PRECISION NOT NULL DEFAULT 50,
  ADD COLUMN "heroTextTabletAlign" TEXT NOT NULL DEFAULT 'CENTER',
  ADD COLUMN "heroTextTabletColor" TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN "heroTextTabletFontSize" INTEGER NOT NULL DEFAULT 42,
  ADD COLUMN "heroTextTabletFontWeight" INTEGER NOT NULL DEFAULT 800,
  ADD COLUMN "heroTextTabletLetterSpacing" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  ADD COLUMN "heroTextTabletUppercase" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "heroTextTabletMaxWidth" INTEGER NOT NULL DEFAULT 90,
  ADD COLUMN "heroTextMobileAlign" TEXT NOT NULL DEFAULT 'CENTER',
  ADD COLUMN "heroTextMobileColor" TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN "heroTextMobileFontWeight" INTEGER NOT NULL DEFAULT 800,
  ADD COLUMN "heroTextMobileLetterSpacing" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
  ADD COLUMN "heroTextMobileUppercase" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "heroTextMobileMaxWidth" INTEGER NOT NULL DEFAULT 90;

UPDATE "WebsiteMediaPlacement"
SET
  "heroTextTabletX" = "heroTextX",
  "heroTextTabletY" = "heroTextY",
  "heroTextTabletAlign" = "heroTextAlign",
  "heroTextTabletColor" = "heroTextColor",
  "heroTextTabletFontSize" = "heroTextFontSize",
  "heroTextTabletFontWeight" = "heroTextFontWeight",
  "heroTextTabletLetterSpacing" = "heroTextLetterSpacing",
  "heroTextTabletUppercase" = "heroTextUppercase",
  "heroTextTabletMaxWidth" = "heroTextMaxWidth",
  "heroTextMobileX" = COALESCE("heroTextMobileX", "heroTextX"),
  "heroTextMobileY" = COALESCE("heroTextMobileY", "heroTextY"),
  "heroTextMobileAlign" = "heroTextAlign",
  "heroTextMobileColor" = "heroTextColor",
  "heroTextMobileFontSize" = COALESCE("heroTextMobileFontSize", 30),
  "heroTextMobileFontWeight" = "heroTextFontWeight",
  "heroTextMobileLetterSpacing" = "heroTextLetterSpacing",
  "heroTextMobileUppercase" = "heroTextUppercase",
  "heroTextMobileMaxWidth" = "heroTextMaxWidth";

ALTER TABLE "WebsiteMediaPlacement"
  ALTER COLUMN "heroTextMobileX" SET DEFAULT 50,
  ALTER COLUMN "heroTextMobileX" SET NOT NULL,
  ALTER COLUMN "heroTextMobileY" SET DEFAULT 50,
  ALTER COLUMN "heroTextMobileY" SET NOT NULL,
  ALTER COLUMN "heroTextMobileFontSize" SET DEFAULT 30,
  ALTER COLUMN "heroTextMobileFontSize" SET NOT NULL;
