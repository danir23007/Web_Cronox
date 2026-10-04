-- Preserve all existing campaigns and their subjects; names are optional.
ALTER TABLE "MailboxDraft" ADD COLUMN "campaignName" TEXT;
