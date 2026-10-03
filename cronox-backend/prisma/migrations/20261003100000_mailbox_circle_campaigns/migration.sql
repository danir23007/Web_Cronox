BEGIN;
-- AlterTable
ALTER TABLE "MailboxDraft" ADD COLUMN     "circles" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "html" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'individual',
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "MailboxCampaign" (
    "errorCode" TEXT,
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "draftRevision" INTEGER NOT NULL,
    "requestKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxCampaignDelivery" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "readyAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "sentCopyStatus" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',

    CONSTRAINT "MailboxCampaignDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxCampaignClock" (
    "id" TEXT NOT NULL,
    "nextAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MailboxCampaignClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxSuppression" (
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxSuppression_pkey" PRIMARY KEY ("email")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailboxCampaign_requestKey_key" ON "MailboxCampaign"("requestKey");

-- CreateIndex
CREATE INDEX "MailboxCampaign_status_scheduledAt_idx" ON "MailboxCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxCampaign_draftId_draftRevision_key" ON "MailboxCampaign"("draftId", "draftRevision");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxCampaignDelivery_messageId_key" ON "MailboxCampaignDelivery"("messageId");

-- CreateIndex
CREATE INDEX "MailboxCampaignDelivery_status_readyAt_idx" ON "MailboxCampaignDelivery"("status", "readyAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxCampaignDelivery_campaignId_email_key" ON "MailboxCampaignDelivery"("campaignId", "email");

-- AddForeignKey
ALTER TABLE "MailboxCampaign" ADD CONSTRAINT "MailboxCampaign_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "MailboxDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxCampaignDelivery" ADD CONSTRAINT "MailboxCampaignDelivery_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MailboxCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "MailboxCampaign" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MailboxCampaign" FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "MailboxCampaign" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "MailboxCampaign" FROM authenticated;
  END IF;
END $private$;

ALTER TABLE "MailboxCampaignDelivery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MailboxCampaignDelivery" FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "MailboxCampaignDelivery" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "MailboxCampaignDelivery" FROM authenticated;
  END IF;
END $private$;

ALTER TABLE "MailboxCampaignClock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MailboxCampaignClock" FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "MailboxCampaignClock" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "MailboxCampaignClock" FROM authenticated;
  END IF;
END $private$;

ALTER TABLE "MailboxSuppression" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MailboxSuppression" FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "MailboxSuppression" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "MailboxSuppression" FROM authenticated;
  END IF;
END $private$;

COMMIT;
