-- AlterTable
ALTER TABLE "MailboxFolder" ADD COLUMN     "retentionUid" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MailboxCampaignDelivery" ADD COLUMN     "bouncedAt" TIMESTAMPTZ(3),
ADD COLUMN     "trackingToken" TEXT,
ADD COLUMN     "versionId" TEXT,
ADD COLUMN     "visitedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "MailboxCampaignVersion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "MailboxCampaignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailboxStorageGarbage" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailboxStorageGarbage_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "MailboxStorageGarbage_createdAt_idx" ON "MailboxStorageGarbage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxCampaignVersion_campaignId_fingerprint_key" ON "MailboxCampaignVersion"("campaignId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "MailboxCampaignDelivery_trackingToken_key" ON "MailboxCampaignDelivery"("trackingToken");

-- CreateIndex
CREATE INDEX "MailboxCampaignDelivery_versionId_idx" ON "MailboxCampaignDelivery"("versionId");

-- AddForeignKey
ALTER TABLE "MailboxCampaignDelivery" ADD CONSTRAINT "MailboxCampaignDelivery_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "MailboxCampaignVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailboxCampaignVersion" ADD CONSTRAINT "MailboxCampaignVersion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MailboxCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MailboxCampaignVersion" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MailboxCampaignVersion" FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "MailboxCampaignVersion" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "MailboxCampaignVersion" FROM authenticated; END IF;
END $private$;

ALTER TABLE "MailboxStorageGarbage" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MailboxStorageGarbage" FROM PUBLIC;
DO $private$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON TABLE "MailboxStorageGarbage" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON TABLE "MailboxStorageGarbage" FROM authenticated; END IF;
END $private$;
