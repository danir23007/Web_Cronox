ALTER TABLE "Category" ADD COLUMN "showInStoreFilters" BOOLEAN NOT NULL DEFAULT true;
-- D#01 is classified explicitly by the owner, preserving IDs/slugs/joins.
UPDATE "Category" SET "group" = 'DROP' WHERE "name" = 'D#01';
