CREATE TABLE "NewsletterMailJob" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "readyAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimedAt" TIMESTAMPTZ(3),
  "claimToken" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT,
  "sentAt" TIMESTAMPTZ(3),
  "tokenHash" TEXT,
  "tokenExpiresAt" TIMESTAMPTZ(3),
  "tokenUsedAt" TIMESTAMPTZ(3),
  "userId" INTEGER,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "NewsletterMailJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NewsletterMailJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "NewsletterMailJob_kind_check" CHECK ("kind" IN ('WELCOME', 'ACCESS')),
  CONSTRAINT "NewsletterMailJob_status_check" CHECK ("status" IN ('QUEUED', 'PROCESSING', 'SENT', 'FAILED', 'UNCERTAIN'))
);
CREATE UNIQUE INDEX "NewsletterMailJob_tokenHash_key" ON "NewsletterMailJob"("tokenHash");
CREATE UNIQUE INDEX "NewsletterMailJob_one_welcome_per_email" ON "NewsletterMailJob"("email") WHERE "kind"='WELCOME';
CREATE INDEX "NewsletterMailJob_status_readyAt_idx" ON "NewsletterMailJob"("status","readyAt");
CREATE INDEX "NewsletterMailJob_email_createdAt_idx" ON "NewsletterMailJob"("email","createdAt");
CREATE INDEX "NewsletterMailJob_userId_createdAt_idx" ON "NewsletterMailJob"("userId","createdAt");

ALTER TABLE "NewsletterMailJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "NewsletterMailJob" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "NewsletterMailJob" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "NewsletterMailJob" FROM authenticated; END IF;
END $$;
