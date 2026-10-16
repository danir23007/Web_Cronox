BEGIN;
-- Existing QR identities, artwork and global selection are never overwritten.
INSERT INTO "AccreditationDesign" ("id", "name", "renderer", "config", "updatedAt")
VALUES ('metacrilatos', 'METACRILATOS', 'metacrilatos-v1', '{"version":1}', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- PostgreSQL's random UUID gives new accounts an opaque 122-bit random token.
-- The existing identity trigger permanently reserves tokens, including deleted
-- identities. No extension, network service or session credential is involved.
ALTER TABLE "User" ALTER COLUMN "publicMemberToken"
  SET DEFAULT replace(gen_random_uuid()::text, '-', '');
UPDATE "User" SET "publicMemberToken" = replace(gen_random_uuid()::text, '-', '')
WHERE "publicMemberToken" IS NULL;

CREATE TABLE "QrEventGroup" (
  "id" UUID PRIMARY KEY,
  "name" VARCHAR(160) NOT NULL CHECK (length(btrim("name")) > 0),
  "description" VARCHAR(1000) NOT NULL DEFAULT '',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdByIdentityUid" UUID,
  CONSTRAINT "QrEventGroup_createdByIdentityUid_fkey" FOREIGN KEY ("createdByIdentityUid")
    REFERENCES "User"("identityUid") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE TABLE "QrEventParticipant" (
  "id" UUID PRIMARY KEY,
  "groupId" UUID NOT NULL,
  "userIdentityUid" UUID,
  "circleAtRegistration" INTEGER NOT NULL CHECK ("circleAtRegistration" BETWEEN 1 AND 5),
  "registeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "registeredByIdentityUid" UUID,
  CONSTRAINT "QrEventParticipant_groupId_fkey" FOREIGN KEY ("groupId")
    REFERENCES "QrEventGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "QrEventParticipant_userIdentityUid_fkey" FOREIGN KEY ("userIdentityUid")
    REFERENCES "User"("identityUid") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "QrEventParticipant_registeredByIdentityUid_fkey" FOREIGN KEY ("registeredByIdentityUid")
    REFERENCES "User"("identityUid") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "QrEventParticipant_groupId_userIdentityUid_key" ON "QrEventParticipant"("groupId", "userIdentityUid");
CREATE INDEX "QrEventGroup_createdAt_id_idx" ON "QrEventGroup"("createdAt", "id");
CREATE INDEX "QrEventGroup_createdByIdentityUid_idx" ON "QrEventGroup"("createdByIdentityUid");
CREATE INDEX "QrEventParticipant_groupId_registeredAt_id_idx" ON "QrEventParticipant"("groupId", "registeredAt", "id");
CREATE INDEX "QrEventParticipant_userIdentityUid_idx" ON "QrEventParticipant"("userIdentityUid");
CREATE INDEX "QrEventParticipant_registeredByIdentityUid_idx" ON "QrEventParticipant"("registeredByIdentityUid");
-- All access is through authenticated Nest admin routes, never public RPC.
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['QrEventGroup','QrEventParticipant'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
