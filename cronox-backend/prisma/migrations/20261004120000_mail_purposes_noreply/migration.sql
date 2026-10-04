BEGIN;

-- Retire templates without deleting designs, versions, deliveries or business data.
UPDATE "ManagedEmailTemplate" SET "archivedAt" = COALESCE("archivedAt", CURRENT_TIMESTAMP)
WHERE purpose IN ('PRE_REGISTRATION_CONFIRMATION','LAUNCH','NEWSLETTER_CONFIRMATION','FIRST_ORDER_DISCOUNT','GENERIC','TEST');
DELETE FROM "EmailPublication" WHERE purpose IN ('PRE_REGISTRATION_CONFIRMATION','LAUNCH','NEWSLETTER_CONFIRMATION','FIRST_ORDER_DISCOUNT','GENERIC','TEST');

-- Cancel pending sends derived from retired templates, preserving uncertain/sent history.
UPDATE "MailboxSend" s SET status='FAILED', "errorCode"='MAIL_PURPOSE_RETIRED', "completedAt"=CURRENT_TIMESTAMP
FROM "MailboxDraft" d JOIN "ManagedEmailTemplate" t ON t.id=d."templateId"
WHERE s."draftId"=d.id AND s.status='PENDING'
AND t.purpose IN ('PRE_REGISTRATION_CONFIRMATION','LAUNCH','NEWSLETTER_CONFIRMATION','FIRST_ORDER_DISCOUNT','GENERIC','TEST','RESTOCK','NEWSLETTER_ACCESS','NEWSLETTER_WELCOME');
UPDATE "MailboxCampaign" c SET status='CANCELLED', "cancelledAt"=CURRENT_TIMESTAMP, "errorCode"='MAIL_PURPOSE_RETIRED'
FROM "MailboxDraft" d WHERE c."draftId"=d.id AND c.status IN ('SCHEDULED','PROCESSING','SENDING','PAUSED')
AND (d."templateId" IN (SELECT id FROM "ManagedEmailTemplate" WHERE purpose IN ('PRE_REGISTRATION_CONFIRMATION','LAUNCH','NEWSLETTER_CONFIRMATION','FIRST_ORDER_DISCOUNT','GENERIC','TEST'))
OR d."familyId" IN (SELECT id FROM "CampaignTemplateFamily" WHERE id IN ('campaign:INFO:LAUNCH','campaign:INFO:RESTOCK','campaign:INFO:GENERIC')));
UPDATE "MailboxCampaignDelivery" d SET status='CANCELLED', "errorCode"='MAIL_PURPOSE_RETIRED'
FROM "MailboxCampaign" c WHERE d."campaignId"=c.id AND c."errorCode"='MAIL_PURPOSE_RETIRED' AND d.status='PENDING';

INSERT INTO "EmailSenderProfile" (key,"createdAt","updatedAt") VALUES ('NOREPLY',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING;
INSERT INTO "EmailTemplateFolder" (id,"senderKey",name,position,"createdAt","updatedAt")
SELECT 'noreply-transfer-'||f.id,'NOREPLY',f.name,f.position,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "EmailTemplateFolder" f WHERE f."senderKey"='INFO'
AND EXISTS (SELECT 1 FROM "ManagedEmailTemplate" t WHERE t."folderId"=f.id AND t.purpose IN ('RESTOCK','NEWSLETTER_ACCESS','NEWSLETTER_WELCOME'))
ON CONFLICT ("senderKey",name) DO NOTHING;

-- Copy signatures, including the Info default, so routing does not change the design.
INSERT INTO "EmailSignature" (id,"senderKey",name,document,revision,"archivedAt","createdBy","updatedBy","createdAt","updatedAt")
SELECT 'noreply-transfer-'||id,'NOREPLY',name,document,revision,"archivedAt","createdBy","updatedBy",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "EmailSignature" WHERE "senderKey"='INFO' ON CONFLICT (id) DO NOTHING;

-- Keep both drafts on collision. Existing No-reply import keys/publications win.
UPDATE "ManagedEmailTemplate" t SET
"senderKey"='NOREPLY',
"familyId"=NULL,"campaignCircle"=NULL,
"folderId"=(SELECT n.id FROM "EmailTemplateFolder" n JOIN "EmailTemplateFolder" f ON f.name=n.name WHERE f.id=t."folderId" AND n."senderKey"='NOREPLY'),
"importKey"=CASE WHEN EXISTS (SELECT 1 FROM "ManagedEmailTemplate" n WHERE n."importKey"=replace(t."importKey",'INFO:','NOREPLY:')) THEN NULL ELSE replace(t."importKey",'INFO:','NOREPLY:') END,
"signatureId"=CASE WHEN t."signatureMode"='default' THEN (SELECT 'noreply-transfer-'||"defaultSignatureId" FROM "EmailSenderProfile" WHERE key='INFO') WHEN t."signatureId" IS NOT NULL THEN 'noreply-transfer-'||t."signatureId" ELSE NULL END,
"signatureMode"=CASE WHEN t."signatureMode"='default' THEN CASE WHEN (SELECT "defaultSignatureId" FROM "EmailSenderProfile" WHERE key='INFO') IS NULL THEN 'none' ELSE 'selected' END ELSE t."signatureMode" END,
"revision"=t."revision"+1,"updatedAt"=CURRENT_TIMESTAMP
WHERE t."senderKey"='INFO' AND t.purpose IN ('RESTOCK','NEWSLETTER_ACCESS','NEWSLETTER_WELCOME');

-- New routed versions preserve immutable historical snapshots and published content.
INSERT INTO "EmailTemplateVersion" (id,"templateId",snapshot,"createdBy","createdAt")
SELECT 'noreply-transfer-'||v.id,v."templateId",
v.snapshot::jsonb || jsonb_build_object('senderKey','NOREPLY','folderId',t."folderId",
'signatureMode',CASE WHEN v.snapshot->>'signatureMode'='default' THEN CASE WHEN p."defaultSignatureId" IS NULL THEN 'none' ELSE 'selected' END ELSE v.snapshot->>'signatureMode' END,
'signatureId',CASE WHEN v.snapshot->>'signatureMode'='default' THEN 'noreply-transfer-'||p."defaultSignatureId" WHEN v.snapshot->>'signatureId' IS NOT NULL THEN 'noreply-transfer-'||(v.snapshot->>'signatureId') ELSE NULL END),
v."createdBy",CURRENT_TIMESTAMP
FROM "EmailPublication" pub JOIN "EmailTemplateVersion" v ON v.id=pub."versionId"
JOIN "ManagedEmailTemplate" t ON t.id=v."templateId"
LEFT JOIN "EmailSenderProfile" p ON p.key='INFO'
WHERE pub."senderKey"='INFO' AND pub.purpose IN ('RESTOCK','NEWSLETTER_ACCESS','NEWSLETTER_WELCOME');
INSERT INTO "EmailPublication" ("senderKey",purpose,"versionId","updatedAt")
SELECT 'NOREPLY',purpose,'noreply-transfer-'||"versionId",CURRENT_TIMESTAMP FROM "EmailPublication"
WHERE "senderKey"='INFO' AND purpose IN ('RESTOCK','NEWSLETTER_ACCESS','NEWSLETTER_WELCOME')
ON CONFLICT ("senderKey",purpose) DO NOTHING;
DELETE FROM "EmailPublication" WHERE "senderKey"='INFO' AND purpose IN ('RESTOCK','NEWSLETTER_ACCESS','NEWSLETTER_WELCOME');

COMMIT;
