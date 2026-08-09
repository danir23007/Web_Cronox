-- Additive auth hardening only. Do not rewrite earlier migrations: the legacy
-- migration history is not safely replayable against a clean database.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- A missing role is never an administrator. Normalize historical NULL values
-- to the least-privileged canonical role before enforcing the schema contract.
UPDATE "User"
  SET "role" = 'USER'
  WHERE "role" IS NULL;

ALTER TABLE "User"
  ALTER COLUMN "role" SET DEFAULT 'USER';

ALTER TABLE "User"
  ALTER COLUMN "role" SET NOT NULL;

-- Existing reset tokens were stored in clear text by older application code.
-- Expire them instead of attempting to hash unknown plaintext values.
UPDATE "PasswordResetToken"
  SET "usedAt" = CURRENT_TIMESTAMP
  WHERE "usedAt" IS NULL;

CREATE TABLE IF NOT EXISTS "NewsletterSubscription" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "verificationTokenHash" TEXT,
  "verificationExpiresAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NewsletterSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscription_email_key"
  ON "NewsletterSubscription"("email");

CREATE UNIQUE INDEX IF NOT EXISTS "NewsletterSubscription_verificationTokenHash_key"
  ON "NewsletterSubscription"("verificationTokenHash");

CREATE INDEX IF NOT EXISTS "NewsletterSubscription_verifiedAt_idx"
  ON "NewsletterSubscription"("verifiedAt");
