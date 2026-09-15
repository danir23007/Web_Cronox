-- Canonicalize the user role enum without losing user data.
-- The preflight fails before any mutation if an unexpected historical role is present.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User"
    WHERE "role"::text NOT IN ('USER', 'FRIEND', 'ADMIN', 'SUPERADMIN', 'SUPER_ADMIN')
  ) THEN
    RAISE EXCEPTION 'Cannot canonicalize Role: unsupported values are still assigned to users';
  END IF;
END
$$;

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;

UPDATE "User"
SET
  "role" = 'SUPERADMIN',
  "sessionVersion" = "sessionVersion" + 1
WHERE "role"::text = 'SUPER_ADMIN';

CREATE TYPE "Role_canonical" AS ENUM ('USER', 'FRIEND', 'ADMIN', 'SUPERADMIN');

ALTER TABLE "User"
ALTER COLUMN "role" TYPE "Role_canonical"
USING ("role"::text::"Role_canonical");

DROP TYPE "Role";
ALTER TYPE "Role_canonical" RENAME TO "Role";

ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';

COMMIT;
