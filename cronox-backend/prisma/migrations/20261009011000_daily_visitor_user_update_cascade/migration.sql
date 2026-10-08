BEGIN;
-- The deployed daily-history migration used NO ACTION on updates, whereas
-- Prisma's generated schema uses CASCADE. Preserve rows and their identities.
ALTER TABLE "DailyVisitor" DROP CONSTRAINT "DailyVisitor_userId_fkey";
ALTER TABLE "DailyVisitor" ADD CONSTRAINT "DailyVisitor_userId_fkey"
 FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
