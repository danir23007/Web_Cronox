-- Existing product only. No delete/create, cascades, variant or order writes.
-- Lock covers both collision checks and the update, including inactive products.
BEGIN;
LOCK TABLE "Product" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Product" WHERE slug IN ('shielded-coal', 'armored-coal') AND id <> 4) THEN
    RAISE EXCEPTION 'ARMORED COAL slug collision: resolve manually before deploying';
  END IF;
  IF EXISTS (SELECT 1 FROM "Product" WHERE id = 4) THEN
    IF NOT EXISTS (SELECT 1 FROM "Product" WHERE id = 4 AND name = 'ARMORED COAL' AND slug IN ('shielded-coal', 'armored-coal')) THEN
      RAISE EXCEPTION 'Product 4 identity differs from verified ARMORED COAL; refusing to change it';
    END IF;
    UPDATE "Product" SET slug = 'armored-coal', "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = 4 AND slug = 'shielded-coal';
  END IF;
END $$;
-- Reserve the old address permanently. Prevent old imports/admin clients from
-- restoring it, and prevent another product taking the canonical destination.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"Product"'::regclass AND conname = 'Product_armored_coal_slug_check') THEN
    ALTER TABLE "Product" ADD CONSTRAINT "Product_armored_coal_slug_check"
      CHECK (slug <> 'shielded-coal' AND (slug <> 'armored-coal' OR id = 4));
  END IF;
END $$;
COMMIT;
