-- Additive: content, publications and legacy campaigns are retained unchanged.
CREATE TABLE "CampaignTemplateFamily" (
  "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "eventKind" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "CampaignTemplateFamily_eventKind_check" CHECK ("eventKind" IN ('LAUNCH','RESTOCK','GENERAL'))
);
ALTER TABLE "CampaignTemplateFamily" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CampaignTemplateFamily" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "CampaignTemplateFamily" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "CampaignTemplateFamily" FROM authenticated; END IF;
END $$;
ALTER TABLE "ManagedEmailTemplate" ADD COLUMN "familyId" TEXT REFERENCES "CampaignTemplateFamily"("id") ON DELETE RESTRICT,
  ADD COLUMN "campaignCircle" INTEGER, ADD COLUMN "textOverride" TEXT;
ALTER TABLE "ManagedEmailTemplate" ADD CONSTRAINT "ManagedEmailTemplate_campaign_identity_check" CHECK (
  ("familyId" IS NULL AND "campaignCircle" IS NULL) OR
  ("familyId" IS NOT NULL AND "campaignCircle" BETWEEN 1 AND 5 AND "senderKey"='INFO' AND
    ("purpose" IS NULL OR "purpose" IN ('LAUNCH','RESTOCK','GENERIC'))));
CREATE UNIQUE INDEX "ManagedEmailTemplate_familyId_campaignCircle_key" ON "ManagedEmailTemplate"("familyId","campaignCircle");
ALTER TABLE "MailboxDraft" ADD COLUMN "familyId" TEXT REFERENCES "CampaignTemplateFamily"("id") ON DELETE RESTRICT,
  ADD COLUMN "campaignEvent" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "MailboxCampaignDelivery" ADD COLUMN "circleLevel" INTEGER, ADD COLUMN "content" JSONB;
ALTER TABLE "MailboxCampaignDelivery" ADD CONSTRAINT "MailboxCampaignDelivery_circle_check" CHECK ("circleLevel" BETWEEN 1 AND 5);
-- Match explicit importer identities, never visible names or mutable folders.
CREATE FUNCTION cronox_campaign_import_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE kind TEXT; label TEXT;
BEGIN
  IF NEW."familyId" IS NULL AND NEW."senderKey"='INFO' AND
     NEW."importKey" ~ '^INFO:[1-5]:(LAUNCH|RESTOCK|GENERIC)$' AND
     NEW."purpose" = split_part(NEW."importKey", ':', 3) THEN
    kind := split_part(NEW."importKey", ':', 3);
    label := CASE kind WHEN 'RESTOCK' THEN 'Aviso de reposición de talla'
      WHEN 'LAUNCH' THEN 'Lanzamiento de la tienda' ELSE 'Comunicación general' END;
    INSERT INTO "CampaignTemplateFamily" (id,name,"eventKind")
      VALUES ('campaign:INFO:'||kind,label,CASE kind WHEN 'GENERIC' THEN 'GENERAL' ELSE kind END)
      ON CONFLICT (id) DO NOTHING;
    NEW."familyId" := 'campaign:INFO:'||kind;
    NEW."campaignCircle" := split_part(NEW."importKey", ':', 2)::integer;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cronox_campaign_import_identity BEFORE INSERT OR UPDATE OF "importKey"
  ON "ManagedEmailTemplate" FOR EACH ROW EXECUTE FUNCTION cronox_campaign_import_identity();
-- Fires the same reviewed mapping on existing imports; does not rewrite content/revisions.
UPDATE "ManagedEmailTemplate" SET "importKey"="importKey"
  WHERE "senderKey"='INFO' AND "importKey" ~ '^INFO:[1-5]:(LAUNCH|RESTOCK|GENERIC)$'
    AND "purpose"=split_part("importKey",':',3);
