BEGIN;
-- Do not guess the owner of historical duplicates. Abort for manual review.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "User" GROUP BY lower(btrim(email)) HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "NewsletterSubscription" GROUP BY lower(btrim(email)) HAVING count(*) > 1)
    OR EXISTS (SELECT 1 FROM "User" WHERE "memberCode" IS NOT NULL GROUP BY lower(btrim("memberCode")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Normalized identity/email collision: review audit before migration; do not merge accounts automatically';
  END IF;
END $$;
CREATE UNIQUE INDEX "User_normalized_email_key" ON "User" (lower(btrim(email)));
CREATE UNIQUE INDEX "NewsletterSubscription_normalized_email_key" ON "NewsletterSubscription" (lower(btrim(email)));
UPDATE "User" SET email = lower(btrim(email)), "updatedAt" = CURRENT_TIMESTAMP WHERE email IS DISTINCT FROM lower(btrim(email));
UPDATE "NewsletterSubscription" SET email = lower(btrim(email)), "updatedAt" = CURRENT_TIMESTAMP WHERE email IS DISTINCT FROM lower(btrim(email));
UPDATE "NewsletterMailJob" SET email = lower(btrim(email)) WHERE email IS DISTINCT FROM lower(btrim(email));
ALTER TABLE "NewsletterSubscription" ADD COLUMN "userId" INTEGER;
ALTER TABLE "NewsletterSubscription" ADD CONSTRAINT "NewsletterSubscription_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "NewsletterSubscription_userId_idx" ON "NewsletterSubscription"("userId");

-- Deliberately no FK: these reservations survive account deletion. Never reuse
-- a code or QR token already assigned to another primary key.
CREATE TABLE "UserIdentityReservation" (
  "userId" INTEGER PRIMARY KEY,
  "memberCode" TEXT UNIQUE,
  "publicMemberToken" TEXT UNIQUE,
  "reservedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "UserIdentityReservation_normalized_code_key"
  ON "UserIdentityReservation" (lower(btrim("memberCode")));
INSERT INTO "UserIdentityReservation" ("userId", "memberCode", "publicMemberToken")
SELECT id, "memberCode", "publicMemberToken" FROM "User";
CREATE SEQUENCE IF NOT EXISTS public.user_member_code_seq MINVALUE 1 START 1 NO CYCLE;
SELECT setval('public.user_member_code_seq', GREATEST(
  (SELECT last_value FROM public.user_member_code_seq),
  COALESCE((SELECT max(COALESCE(NULLIF(m[1], '')::bigint, 0) * 999999 + m[2]::bigint)
    FROM (SELECT regexp_match("memberCode", '^CRX([0-9]*)-([0-9]{6})$') m FROM "UserIdentityReservation") codes), 0)
), true);

CREATE FUNCTION preserve_user_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous "UserIdentityReservation"; n bigint; code text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'User primary key is immutable'; END IF;
  IF TG_OP = 'INSERT' AND NEW."memberCode" IS NULL THEN
    LOOP
      n := nextval('public.user_member_code_seq');
      code := 'CRX' || CASE WHEN (n-1)/999999 = 0 THEN '' ELSE ((n-1)/999999)::text END || '-' || lpad((((n-1)%999999)+1)::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "UserIdentityReservation" WHERE lower(btrim("memberCode")) = lower(code));
    END LOOP;
    NEW."memberCode" := code;
  END IF;
  SELECT * INTO previous FROM "UserIdentityReservation" WHERE "userId" = NEW.id FOR UPDATE;
  IF FOUND THEN
    IF (previous."memberCode" IS NOT NULL AND previous."memberCode" IS DISTINCT FROM NEW."memberCode")
      OR (previous."publicMemberToken" IS NOT NULL AND previous."publicMemberToken" IS DISTINCT FROM NEW."publicMemberToken") THEN
      RAISE EXCEPTION 'User public identity is immutable';
    END IF;
    UPDATE "UserIdentityReservation" SET "memberCode" = NEW."memberCode", "publicMemberToken" = NEW."publicMemberToken" WHERE "userId" = NEW.id;
  ELSE
    INSERT INTO "UserIdentityReservation" ("userId", "memberCode", "publicMemberToken") VALUES (NEW.id, NEW."memberCode", NEW."publicMemberToken");
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_preserve_identity" BEFORE INSERT OR UPDATE OF id, "memberCode", "publicMemberToken" ON "User"
  FOR EACH ROW EXECUTE FUNCTION preserve_user_identity();
-- Assign only missing codes. Keep every issued code and QR exactly unchanged.
DO $$ DECLARE row record; n bigint; code text;
BEGIN
  FOR row IN SELECT id FROM "User" WHERE "memberCode" IS NULL ORDER BY "createdAt", id LOOP
    LOOP
      n := nextval('public.user_member_code_seq');
      code := 'CRX' || CASE WHEN (n-1)/999999 = 0 THEN '' ELSE ((n-1)/999999)::text END || '-' || lpad((((n-1)%999999)+1)::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "UserIdentityReservation" WHERE lower(btrim("memberCode")) = lower(code));
    END LOOP;
    UPDATE "User" SET "memberCode" = code WHERE id = row.id;
  END LOOP;
END $$;
ALTER TABLE "UserIdentityReservation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "UserIdentityReservation" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "UserIdentityReservation" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "UserIdentityReservation" FROM authenticated; END IF;
END $$;
COMMIT;
