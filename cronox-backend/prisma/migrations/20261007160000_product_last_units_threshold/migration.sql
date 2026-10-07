-- Nullable: existing products keep the warning disabled.
ALTER TABLE "Product" ADD COLUMN "lastUnitsThreshold" INTEGER;
ALTER TABLE "Product" ADD CONSTRAINT "Product_lastUnitsThreshold_nonnegative"
  CHECK ("lastUnitsThreshold" IS NULL OR "lastUnitsThreshold" >= 0);
