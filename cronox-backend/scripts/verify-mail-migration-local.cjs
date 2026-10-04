// Execute the real migration against collision/customization fixtures, then roll back.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadLocalEnvironment, ensureLocalPostgres } = require('./start-local.cjs');
const local = loadLocalEnvironment();
ensureLocalPostgres(local);
const url = new URL(local.DATABASE_URL);
assert(['127.0.0.1', 'localhost'].includes(url.hostname));
assert.equal(local.EMAIL_ENABLED, 'false');
assert.equal(local.BACKGROUND_JOBS_ENABLED, 'false');
const fixture = `BEGIN;
INSERT INTO "EmailSenderProfile" (key,"createdAt","updatedAt") VALUES ('INFO',now(),now()),('NOREPLY',now(),now()) ON CONFLICT DO NOTHING;
INSERT INTO "EmailTemplateFolder" (id,"senderKey",name,"createdAt","updatedAt") VALUES ('policy-info-folder','INFO','Local migration fixture',now(),now()),('policy-noreply-folder','NOREPLY','Local migration fixture',now(),now());
INSERT INTO "EmailSignature" (id,"senderKey",name,document,"createdAt","updatedAt") VALUES ('policy-signature','INFO','Local signature','{"blocks":[{"type":"text","text":"custom signature"}]}',now(),now());
UPDATE "EmailSenderProfile" SET "defaultSignatureId"='policy-signature' WHERE key='INFO';
INSERT INTO "CampaignTemplateFamily" (id,name,"eventKind") VALUES ('policy-family','Local restock family','RESTOCK');
INSERT INTO "ManagedEmailTemplate" (id,"senderKey","folderId","importKey",name,purpose,subject,document,html,text,"signatureMode","familyId","campaignCircle","createdAt","updatedAt") VALUES
('policy-info-access','INFO','policy-info-folder','INFO:fixture:NEWSLETTER_ACCESS','Custom Info access','NEWSLETTER_ACCESS','Custom access','{"blocks":[{"type":"text","text":"custom Info content"}]}','custom Info content','custom Info content','default',null,null,now(),now()),
('policy-noreply-access','NOREPLY','policy-noreply-folder','NOREPLY:fixture:NEWSLETTER_ACCESS','Existing No-reply access','NEWSLETTER_ACCESS','Existing access','{"blocks":[{"type":"text","text":"existing No-reply content"}]}','existing No-reply content','existing No-reply content','none',null,null,now(),now()),
('policy-info-welcome','INFO','policy-info-folder',null,'Custom welcome','NEWSLETTER_WELCOME','Custom welcome','{"blocks":[{"type":"text","text":"custom welcome {{discountCode}}"}]}','custom welcome','custom welcome','default',null,null,now(),now()),
('policy-info-restock','INFO','policy-info-folder',null,'Custom restock','RESTOCK','Restock','{"blocks":[{"type":"text","text":"custom restock"}]}','custom restock','custom restock','none','policy-family',1,now(),now()),
('policy-retired','INFO','policy-info-folder',null,'Retired launch','LAUNCH','Retired','{"blocks":[{"type":"text","text":"historical design"}]}','historical design','historical design','none',null,null,now(),now());
INSERT INTO "EmailTemplateVersion" (id,"templateId",snapshot) SELECT 'version-'||id,id,to_jsonb(t) FROM "ManagedEmailTemplate" t WHERE id IN ('policy-info-access','policy-noreply-access','policy-info-welcome','policy-retired');
INSERT INTO "EmailPublication" ("senderKey",purpose,"versionId","updatedAt") VALUES
('INFO','NEWSLETTER_ACCESS','version-policy-info-access',now()),('NOREPLY','NEWSLETTER_ACCESS','version-policy-noreply-access',now()),('INFO','NEWSLETTER_WELCOME','version-policy-info-welcome',now()),('INFO','LAUNCH','version-policy-retired',now()) ON CONFLICT ("senderKey",purpose) DO UPDATE SET "versionId"=excluded."versionId";
DELETE FROM "EmailPublication" WHERE "senderKey"='NOREPLY' AND purpose='NEWSLETTER_WELCOME';
INSERT INTO "EmailDelivery" (id,"senderKey",recipient,subject,purpose,status,"updatedAt") VALUES ('policy-history','INFO','local@example.test','Old launch','LAUNCH','SMTP_ACCEPTED',now());
-- Representative queues before either migration, with no provider connection.
ALTER TABLE "MailboxDraft" DROP COLUMN "campaignName";
INSERT INTO "Mailbox" (id,name,address,"fromName",provider,"imapHost","smtpHost",username,"updatedAt")
VALUES ('policy-box','Local migration','migration@example.test','CRONOX','hostinger','localhost','localhost','migration@example.test',now());
INSERT INTO "MailboxDraft" (id,"mailboxId","userId",mode,"templateId",subject,text,"updatedAt") VALUES
('policy-retired-draft','policy-box',1,'individual','policy-retired','Preserved retired subject','Preserved body',now()),
('policy-moved-draft','policy-box',1,'individual','policy-info-access','Preserved moved subject','Preserved body',now()),
('policy-valid-draft','policy-box',1,'campaign',null,'Preserved campaign subject','Preserved body',now());
INSERT INTO "CampaignTemplateFamily" (id,name,"eventKind") VALUES ('campaign:INFO:GENERIC','Old automatic family','GENERAL') ON CONFLICT DO NOTHING;
INSERT INTO "MailboxDraft" (id,"mailboxId","userId",mode,"familyId","updatedAt") VALUES ('policy-family-draft','policy-box',1,'campaign','campaign:INFO:GENERIC',now());
INSERT INTO "MailboxSend" (id,"draftId","draftRevision","userId","sessionId","sessionVersion","messageId","requestKey",status) VALUES
('policy-retired-send','policy-retired-draft',1,1,'local',1,'<policy-retired@local>','policy-retired-send','PENDING'),
('policy-moved-send','policy-moved-draft',1,1,'local',1,'<policy-moved@local>','policy-moved-send','PENDING'),
('policy-uncertain-send','policy-retired-draft',2,1,'local',1,'<policy-uncertain@local>','policy-uncertain-send','UNKNOWN');
INSERT INTO "MailboxCampaign" (id,"draftId","draftRevision","requestKey",status,"scheduledAt",snapshot) VALUES
('policy-retired-campaign','policy-retired-draft',1,'policy-retired-campaign','PROCESSING',now(),'{}'),
('policy-valid-campaign','policy-valid-draft',1,'policy-valid-campaign','SCHEDULED',now(),'{}');
INSERT INTO "MailboxCampaign" (id,"draftId","draftRevision","requestKey",status,"scheduledAt",snapshot) VALUES ('policy-family-campaign','policy-family-draft',1,'policy-family-campaign','PAUSED',now(),'{}');
INSERT INTO "MailboxCampaignDelivery" (id,"campaignId",email,"messageId",status) VALUES
('policy-pending-delivery','policy-retired-campaign','pending@example.test','<policy-pending@local>','PENDING'),
('policy-unknown-delivery','policy-retired-campaign','unknown@example.test','<policy-unknown@local>','UNKNOWN'),
('policy-sent-delivery','policy-retired-campaign','sent@example.test','<policy-sent@local>','SMTP_ACCEPTED');
`;
const migration = fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261004120000_mail_purposes_noreply/migration.sql'),'utf8').replace(/^BEGIN;/,'').replace(/COMMIT;\s*$/,'');
const nameMigration = fs.readFileSync(path.join(__dirname,'../prisma/migrations/20261004130000_campaign_internal_name/migration.sql'),'utf8');
const verify = `DO $$ BEGIN
IF (SELECT "senderKey" FROM "ManagedEmailTemplate" WHERE id='policy-info-access') <> 'NOREPLY' THEN RAISE EXCEPTION 'access routing'; END IF;
IF (SELECT "importKey" FROM "ManagedEmailTemplate" WHERE id='policy-info-access') IS NOT NULL THEN RAISE EXCEPTION 'import collision'; END IF;
IF (SELECT document->'blocks'->0->>'text' FROM "ManagedEmailTemplate" WHERE id='policy-info-access') <> 'custom Info content' THEN RAISE EXCEPTION 'lost design'; END IF;
IF (SELECT "signatureId" FROM "ManagedEmailTemplate" WHERE id='policy-info-access') <> 'noreply-transfer-policy-signature' THEN RAISE EXCEPTION 'lost signature'; END IF;
IF (SELECT "familyId" FROM "ManagedEmailTemplate" WHERE id='policy-info-restock') IS NOT NULL THEN RAISE EXCEPTION 'Info family routing'; END IF;
IF (SELECT "versionId" FROM "EmailPublication" WHERE "senderKey"='NOREPLY' AND purpose='NEWSLETTER_ACCESS') <> 'version-policy-noreply-access' THEN RAISE EXCEPTION 'overwrote No-reply publication'; END IF;
IF (SELECT v.snapshot->'document'->'blocks'->0->>'text' FROM "EmailPublication" p JOIN "EmailTemplateVersion" v ON v.id=p."versionId" WHERE p."senderKey"='NOREPLY' AND p.purpose='NEWSLETTER_WELCOME') <> 'custom welcome {{discountCode}}' THEN RAISE EXCEPTION 'lost published welcome'; END IF;
IF (SELECT snapshot->>'senderKey' FROM "EmailTemplateVersion" WHERE id='version-policy-info-access') <> 'INFO' THEN RAISE EXCEPTION 'rewrote history'; END IF;
IF (SELECT "archivedAt" FROM "ManagedEmailTemplate" WHERE id='policy-retired') IS NULL THEN RAISE EXCEPTION 'retirement failed'; END IF;
IF NOT EXISTS (SELECT 1 FROM "EmailDelivery" WHERE id='policy-history' AND status='SMTP_ACCEPTED') THEN RAISE EXCEPTION 'lost delivery history'; END IF;
IF NOT EXISTS (SELECT 1 FROM "EmailTemplateVersion" WHERE id='version-policy-retired') THEN RAISE EXCEPTION 'lost historical version'; END IF;
IF (SELECT status FROM "MailboxSend" WHERE id='policy-retired-send') <> 'FAILED' OR
   (SELECT status FROM "MailboxSend" WHERE id='policy-moved-send') <> 'FAILED' THEN RAISE EXCEPTION 'pending obsolete routing survived'; END IF;
IF (SELECT status FROM "MailboxSend" WHERE id='policy-uncertain-send') <> 'UNKNOWN' THEN RAISE EXCEPTION 'uncertain send changed'; END IF;
IF (SELECT status FROM "MailboxCampaign" WHERE id='policy-retired-campaign') <> 'CANCELLED' OR
   (SELECT status FROM "MailboxCampaignDelivery" WHERE id='policy-pending-delivery') <> 'CANCELLED' THEN RAISE EXCEPTION 'retired queue survived'; END IF;
IF (SELECT status FROM "MailboxCampaign" WHERE id='policy-valid-campaign') <> 'SCHEDULED' THEN RAISE EXCEPTION 'custom campaign changed'; END IF;
IF (SELECT status FROM "MailboxCampaign" WHERE id='policy-family-campaign') <> 'CANCELLED' THEN RAISE EXCEPTION 'old automatic family survived'; END IF;
IF (SELECT status FROM "MailboxCampaignDelivery" WHERE id='policy-unknown-delivery') <> 'UNKNOWN' OR
   (SELECT status FROM "MailboxCampaignDelivery" WHERE id='policy-sent-delivery') <> 'SMTP_ACCEPTED' THEN RAISE EXCEPTION 'delivery history changed'; END IF;
IF EXISTS (SELECT 1 FROM "MailboxDraft" WHERE "mailboxId"='policy-box' AND "campaignName" IS NOT NULL) OR
   (SELECT subject FROM "MailboxDraft" WHERE id='policy-valid-draft') <> 'Preserved campaign subject' THEN RAISE EXCEPTION 'name migration changed existing data'; END IF;
END $$;
ROLLBACK;`;
const result = spawnSync(path.join(local.LOCAL_PG_BIN, 'psql.exe'), ['-X','-v','ON_ERROR_STOP=1'], { input: fixture+ migration+nameMigration+verify, encoding: 'utf8', windowsHide: true,
  env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port, PGDATABASE: url.pathname.slice(1), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password) } });
if (result.status !== 0) { console.error(result.stderr); process.exitCode = result.status || 1; }
else console.log(JSON.stringify({ localMigrationVerified: true, fixturesRolledBack: true, preserved: ['both designs','No-reply publication precedence','Info published welcome','signatures','immutable versions','delivery history'], productionTouched: false }));
