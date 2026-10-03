-- Append evidence; do not infer old roles or relationships from current users.
BEGIN;
-- The existing metadata row forbids UPDATE. Adding a default preserves its original start.
ALTER TABLE "VisitorHistoryConfig" ADD COLUMN "deduplicationStartedAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DailyVisitor" ADD COLUMN "disposition" TEXT NOT NULL DEFAULT 'independent', ADD COLUMN "observedRole" TEXT;
ALTER TABLE "DailyVisitor" ADD CONSTRAINT "DailyVisitor_disposition_check" CHECK ("disposition" IN ('independent','linked','adminExcluded'));
CREATE TABLE "DailyVisitorBrowser" (
  id TEXT PRIMARY KEY, day DATE NOT NULL, "proofHash" TEXT NOT NULL,
  visited BOOLEAN NOT NULL DEFAULT false, linked BOOLEAN NOT NULL DEFAULT false,
  "adminExcluded" BOOLEAN NOT NULL DEFAULT false,
  UNIQUE(day, "proofHash")
);
CREATE TABLE "DailyVisitorLink" (
  "browserId" TEXT NOT NULL REFERENCES "DailyVisitorBrowser"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "visitorId" TEXT NOT NULL REFERENCES "DailyVisitor"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY ("browserId", "visitorId")
);
ALTER TABLE "DailyVisitorBrowser" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DailyVisitorLink" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "DailyVisitorBrowser", "DailyVisitorLink" FROM PUBLIC;
CREATE VIEW "CountedDailyVisitor" WITH (security_invoker = true) AS
SELECT * FROM "DailyVisitor"
WHERE disposition = 'independent'
  AND ("observedRole" IS NULL OR "observedRole" IN ('USER', 'FRIEND'));
REVOKE ALL ON "CountedDailyVisitor" FROM PUBLIC;
-- Local PostgreSQL does not necessarily have Supabase's Data API roles.
DO $$ DECLARE r TEXT; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON "DailyVisitorBrowser", "DailyVisitorLink", "CountedDailyVisitor" FROM %I',r);
    END IF;
  END LOOP;
END $$;
COMMIT;
