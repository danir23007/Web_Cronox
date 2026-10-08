-- Manual data repair, NOT a Prisma migration. Review/backup before production use.
-- Updates only editable page content; never user addresses or mail history.
BEGIN;
UPDATE "FooterPageContent"
SET "html" = regexp_replace("html", 'dani\.rivas@cronox\.es', 'support@cronox.es', 'gi'),
    "revision" = "revision" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "html" ~* 'dani\.rivas@cronox\.es'
RETURNING "slug", "revision";
COMMIT;
