ALTER TABLE "KeyScreen"
  ADD COLUMN "desktopHorizontalAlign" "KeyScreenHorizontalAlign",
  ADD COLUMN "desktopVerticalAlign" "KeyScreenVerticalAlign",
  ADD COLUMN "desktopOffsetX" INTEGER,
  ADD COLUMN "desktopOffsetY" INTEGER,
  ADD COLUMN "mobileHorizontalAlign" "KeyScreenHorizontalAlign",
  ADD COLUMN "mobileVerticalAlign" "KeyScreenVerticalAlign",
  ADD COLUMN "mobileOffsetX" INTEGER,
  ADD COLUMN "mobileOffsetY" INTEGER;

UPDATE "KeyScreen"
SET
  "desktopHorizontalAlign" = "horizontalAlign",
  "desktopVerticalAlign" = "verticalAlign",
  "desktopOffsetX" = "offsetX",
  "desktopOffsetY" = "offsetY",
  "mobileHorizontalAlign" = "horizontalAlign",
  "mobileVerticalAlign" = "verticalAlign",
  "mobileOffsetX" = "offsetX",
  "mobileOffsetY" = "offsetY";

ALTER TABLE "KeyScreen"
  ALTER COLUMN "desktopHorizontalAlign" SET DEFAULT 'CENTER',
  ALTER COLUMN "desktopHorizontalAlign" SET NOT NULL,
  ALTER COLUMN "desktopVerticalAlign" SET DEFAULT 'CENTER',
  ALTER COLUMN "desktopVerticalAlign" SET NOT NULL,
  ALTER COLUMN "desktopOffsetX" SET DEFAULT 0,
  ALTER COLUMN "desktopOffsetX" SET NOT NULL,
  ALTER COLUMN "desktopOffsetY" SET DEFAULT 0,
  ALTER COLUMN "desktopOffsetY" SET NOT NULL,
  ALTER COLUMN "mobileHorizontalAlign" SET DEFAULT 'CENTER',
  ALTER COLUMN "mobileHorizontalAlign" SET NOT NULL,
  ALTER COLUMN "mobileVerticalAlign" SET DEFAULT 'CENTER',
  ALTER COLUMN "mobileVerticalAlign" SET NOT NULL,
  ALTER COLUMN "mobileOffsetX" SET DEFAULT 0,
  ALTER COLUMN "mobileOffsetX" SET NOT NULL,
  ALTER COLUMN "mobileOffsetY" SET DEFAULT 0,
  ALTER COLUMN "mobileOffsetY" SET NOT NULL;
