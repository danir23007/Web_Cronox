-- Administrative data is accessed through the guarded Nest endpoints only.
-- Preserve issued identities and historical templates; no row modifications.
ALTER TABLE "PhysicalBarcode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LabelTemplateSettings" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PhysicalBarcode", "LabelTemplateSettings" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
   REVOKE ALL ON "PhysicalBarcode", "LabelTemplateSettings" FROM anon;
 END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
   REVOKE ALL ON "PhysicalBarcode", "LabelTemplateSettings" FROM authenticated;
 END IF;
END $$;
