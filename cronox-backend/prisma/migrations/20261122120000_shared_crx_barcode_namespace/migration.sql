-- One permanent registry enforces uniqueness across both identity tables.
CREATE TABLE "PhysicalBarcodeIdentity" (
  "code" VARCHAR(13) PRIMARY KEY,
  CONSTRAINT "PhysicalBarcodeIdentity_format" CHECK ("code" ~ '^CR[XL][0-9]{10}$')
);
INSERT INTO "PhysicalBarcodeIdentity" ("code")
SELECT "code" FROM "PhysicalBarcode"
UNION ALL SELECT "code" FROM "PhysicalLotBarcode";

CREATE SEQUENCE "PhysicalBarcode_crx_serial" MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
SELECT setval('"PhysicalBarcode_crx_serial"',
  GREATEST(1, COALESCE((SELECT max(substring("code" from 4)::bigint) + 1
  FROM "PhysicalBarcodeIdentity" WHERE "code" LIKE 'CRX%'), 1)), false);
ALTER TABLE "PhysicalBarcode" ALTER COLUMN "code"
  SET DEFAULT ('CRX' || lpad(nextval('"PhysicalBarcode_crx_serial"')::text,10,'0'));
ALTER TABLE "PhysicalLotBarcode" ALTER COLUMN "code"
  SET DEFAULT ('CRX' || lpad(nextval('"PhysicalBarcode_crx_serial"')::text,10,'0'));
ALTER TABLE "PhysicalLotBarcode" DROP CONSTRAINT "PhysicalLotBarcode_code_check";
ALTER TABLE "PhysicalLotBarcode" ADD CONSTRAINT "PhysicalLotBarcode_code_check"
  CHECK ("code" ~ '^CR[XL][0-9]{10}$');

CREATE FUNCTION cronox_register_physical_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "PhysicalBarcodeIdentity" ("code") VALUES (NEW."code");
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PhysicalBarcode_global_identity" AFTER INSERT ON "PhysicalBarcode"
FOR EACH ROW EXECUTE FUNCTION cronox_register_physical_identity();
CREATE TRIGGER "PhysicalLotBarcode_global_identity" AFTER INSERT ON "PhysicalLotBarcode"
FOR EACH ROW EXECUTE FUNCTION cronox_register_physical_identity();
ALTER TABLE "PhysicalBarcode" ADD CONSTRAINT "PhysicalBarcode_global_identity_fk"
  FOREIGN KEY ("code") REFERENCES "PhysicalBarcodeIdentity"("code") DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "PhysicalLotBarcode" ADD CONSTRAINT "PhysicalLotBarcode_global_identity_fk"
  FOREIGN KEY ("code") REFERENCES "PhysicalBarcodeIdentity"("code") DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION cronox_retain_physical_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Issued barcode identities must be retained unchanged';
END;
$$;
CREATE TRIGGER "PhysicalBarcodeIdentity_retention" BEFORE UPDATE OR DELETE ON "PhysicalBarcodeIdentity"
FOR EACH ROW EXECUTE FUNCTION cronox_retain_physical_identity();
ALTER TABLE "PhysicalBarcodeIdentity" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PhysicalBarcodeIdentity" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PhysicalBarcodeIdentity" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PhysicalBarcodeIdentity" FROM authenticated; END IF;
END $$;
