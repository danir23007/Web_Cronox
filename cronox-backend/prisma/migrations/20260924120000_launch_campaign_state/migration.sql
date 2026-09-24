ALTER TABLE "KeyScreenSettings"
  ADD COLUMN "launchStatus" TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "launchArmedAt" TIMESTAMPTZ(3),
  ADD COLUMN "launchStartedAt" TIMESTAMPTZ(3),
  ADD COLUMN "launchCompletedAt" TIMESTAMPTZ(3),
  ADD COLUMN "launchTrigger" TEXT,
  ADD COLUMN "launchErrorCode" TEXT;

ALTER TABLE "PreRegistration" ADD COLUMN "launchErrorCode" TEXT;
