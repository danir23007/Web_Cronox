-- Additive, no queue state changes and no SMTP retries. Existing attempts are
-- charged conservatively; accepted/uncertain attempts survive content retention.
ALTER TABLE "EmailDelivery" ADD COLUMN "quotaUnits" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "pendingPayload" TEXT, ADD COLUMN "readyAt" TIMESTAMPTZ(3);
ALTER TABLE "MailboxSend" ADD COLUMN "quotaUnits" INTEGER NOT NULL DEFAULT 1,
 ADD COLUMN "readyAt" TIMESTAMPTZ(3);
CREATE TABLE "MailAccountQuota" (
 id TEXT PRIMARY KEY, account TEXT NOT NULL, units INTEGER NOT NULL CHECK (units>0),
 "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MailAccountQuota_account_reservedAt_idx" ON "MailAccountQuota" (account,"reservedAt");
CREATE INDEX "EmailDelivery_status_readyAt_idx" ON "EmailDelivery" (status,"readyAt");
CREATE INDEX "MailboxSend_status_readyAt_idx" ON "MailboxSend" (status,"readyAt");
UPDATE "EmailDelivery" SET "quotaUnits"=CASE WHEN recipient='[multiple recipients]' THEN 100
 ELSE LEAST(100,GREATEST(1,COALESCE(array_length(regexp_split_to_array(recipient,','),1),1))) END;
UPDATE "MailboxSend" s SET "quotaUnits"=GREATEST(1,cardinality(s.accepted)+cardinality(s.rejected),
 COALESCE(array_length(regexp_split_to_array(trim(both ',' from concat_ws(',',NULLIF(d."to",''),NULLIF(d.cc,''),NULLIF(d.bcc,''))),','),1),1))
 FROM "MailboxDraft" d WHERE d.id=s."draftId";
INSERT INTO "MailAccountQuota" (id,account,units,"reservedAt")
SELECT 'MANUAL:'||s.id,lower(trim(b.username)),s."quotaUnits",s."startedAt"
FROM "MailboxSend" s JOIN "MailboxDraft" d ON d.id=s."draftId" JOIN "Mailbox" b ON b.id=d."mailboxId" WHERE s."startedAt" IS NOT NULL;
INSERT INTO "MailAccountQuota" (id,account,units,"reservedAt")
SELECT 'CAMPAIGN:'||s.id,lower(trim(b.username)),GREATEST(1,s.attempts),s."startedAt"
FROM "MailboxCampaignDelivery" s JOIN "MailboxCampaign" c ON c.id=s."campaignId"
JOIN "MailboxDraft" d ON d.id=c."draftId" JOIN "Mailbox" b ON b.id=d."mailboxId" WHERE s."startedAt" IS NOT NULL;
-- These are the four accounts confirmed for CRONOX. Prefer their authenticated
-- usernames. Runtime reconciliation also handles customized SMTP identities.
INSERT INTO "MailAccountQuota" (id,account,units,"reservedAt")
SELECT 'AUTO:'||e.id,COALESCE((SELECT lower(trim(b.username)) FROM "Mailbox" b WHERE lower(b.address)=
 CASE e."senderKey" WHEN 'NOREPLY' THEN 'no-reply@cronox.es' WHEN 'INFO' THEN 'info@cronox.es'
 WHEN 'ORDERS' THEN 'orders@cronox.es' WHEN 'SUPPORT' THEN 'support@cronox.es' END ORDER BY b.id LIMIT 1),
 CASE e."senderKey" WHEN 'NOREPLY' THEN 'no-reply@cronox.es' WHEN 'INFO' THEN 'info@cronox.es'
 WHEN 'ORDERS' THEN 'orders@cronox.es' WHEN 'SUPPORT' THEN 'support@cronox.es' END),e."quotaUnits",e."createdAt"
FROM "EmailDelivery" e WHERE e."senderKey" IN ('NOREPLY','INFO','ORDERS','SUPPORT');
ALTER TABLE "MailAccountQuota" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "MailAccountQuota" FROM PUBLIC;
DO $private$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "MailAccountQuota" FROM anon; END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "MailAccountQuota" FROM authenticated; END IF;
END $private$;
