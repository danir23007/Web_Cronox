CREATE TYPE "CategoryGroup" AS ENUM ('NEW', 'GARMENT', 'DROP', 'UNCLASSIFIED');
ALTER TABLE "Category" ADD COLUMN "group" "CategoryGroup" NOT NULL DEFAULT 'UNCLASSIFIED';
-- Exact slugs are defined by prisma/seed.ts and the existing public category menu.
-- Unknown/custom categories and all ProductCategory associations remain untouched.
UPDATE "Category" SET "group" = 'NEW' WHERE "slug" = 'novedades';
UPDATE "Category" SET "group" = 'GARMENT' WHERE "slug" IN ('camisetas', 'chaquetas', 'pantalones', 'complementos');
