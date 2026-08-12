-- Accounts created after a completed guest order do not have a password until
-- the customer consumes a secure password-setup/reset link.
ALTER TABLE "User"
  ALTER COLUMN "passwordHash" DROP NOT NULL,
  ADD COLUMN "passwordSetupEmailSentAt" TIMESTAMP(3),
  ADD COLUMN "passwordSetupClaimedAt" TIMESTAMP(3);

-- Existing CRONOX writes are already canonicalized. Enforce that invariant on
-- new/updated rows without making deployment fail on an unexpected legacy row;
-- application lookups remain case-insensitive for such legacy data.
ALTER TABLE "User"
  ADD CONSTRAINT "User_email_canonical_check"
  CHECK (email = lower(btrim(email))) NOT VALID;
