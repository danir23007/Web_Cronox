CREATE TABLE "AdminBulkOperation" (
  "id" UUID PRIMARY KEY,
  "actorId" INTEGER NOT NULL,
  "requestHash" VARCHAR(64) NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminBulkOperation_actorId_createdAt_idx" ON "AdminBulkOperation" ("actorId", "createdAt");
ALTER TABLE "AdminBulkOperation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AdminBulkOperation" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "AdminBulkOperation" FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "AdminBulkOperation" FROM authenticated; END IF;
END $$;
