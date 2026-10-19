-- Keep the original exact numeric identities. Move all live/archived drafts;
-- immutable version snapshots, publications, signatures and families are untouched.
DO $$
DECLARE duplicate_folder RECORD; canonical_id TEXT; circle_number INTEGER;
BEGIN
  LOCK TABLE "EmailTemplateFolder" IN SHARE ROW EXCLUSIVE MODE;
  FOR duplicate_folder IN SELECT * FROM "EmailTemplateFolder" ORDER BY "senderKey", "createdAt", id LOOP
    circle_number := CASE regexp_replace(lower(translate(duplicate_folder.name, 'íÍ', 'ii')), '\s+', '', 'g')
      WHEN 'circulo1' THEN 1 WHEN 'circuloi' THEN 1 WHEN '1' THEN 1 WHEN 'i' THEN 1
      WHEN 'circulo2' THEN 2 WHEN 'circuloii' THEN 2 WHEN '2' THEN 2 WHEN 'ii' THEN 2
      WHEN 'circulo3' THEN 3 WHEN 'circuloiii' THEN 3 WHEN '3' THEN 3 WHEN 'iii' THEN 3
      WHEN 'circulo4' THEN 4 WHEN 'circuloiv' THEN 4 WHEN '4' THEN 4 WHEN 'iv' THEN 4
      WHEN 'circulo5' THEN 5 WHEN 'circulov' THEN 5 WHEN '5' THEN 5 WHEN 'v' THEN 5 ELSE NULL END;
    IF circle_number IS NULL OR duplicate_folder.name = 'Círculo ' || circle_number THEN CONTINUE; END IF;
    SELECT id INTO canonical_id FROM "EmailTemplateFolder"
      WHERE "senderKey" = duplicate_folder."senderKey" AND name = 'Círculo ' || circle_number;
    IF canonical_id IS NULL THEN
      RAISE EXCEPTION 'Missing original canonical circle % for sender %; initialize it before reconciling aliases', circle_number, duplicate_folder."senderKey";
    END IF;
    UPDATE "ManagedEmailTemplate" SET "folderId" = canonical_id WHERE "folderId" = duplicate_folder.id AND "senderKey" = duplicate_folder."senderKey";
    INSERT INTO "AuditLog" (action, "actionType", "targetType", "targetId", metadata)
      VALUES ('EMAIL_CIRCLE_FOLDER_RECONCILE', 'EMAIL_CIRCLE_FOLDER_RECONCILE', 'EMAIL_TEMPLATE_FOLDER', duplicate_folder.id,
        jsonb_build_object('canonicalId', canonical_id, 'senderKey', duplicate_folder."senderKey", 'circle', circle_number));
    DELETE FROM "EmailTemplateFolder" WHERE id = duplicate_folder.id;
  END LOOP;
END $$;

-- Reject equivalent spellings at the database boundary. Application resolvers
-- return the existing canonical row instead of inserting/renaming an alias.
ALTER TABLE "EmailTemplateFolder" ADD CONSTRAINT "EmailTemplateFolder_canonical_circle_name" CHECK (
  regexp_replace(lower(translate(name, 'íÍ', 'ii')), '\s+', '', 'g') !~ '^(circulo)?(1|2|3|4|5|i|ii|iii|iv|v)$'
  OR name IN ('Círculo 1', 'Círculo 2', 'Círculo 3', 'Círculo 4', 'Círculo 5')
);
