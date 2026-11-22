CREATE SEQUENCE "PhysicalLotBarcode_serial" MAXVALUE 9999999999 NO CYCLE;
CREATE TABLE "PhysicalLotBarcode" (
 "code" VARCHAR(13) PRIMARY KEY DEFAULT ('CRL' || lpad(nextval('"PhysicalLotBarcode_serial"')::text,10,'0')),
 "variantId" INTEGER NOT NULL REFERENCES "ProductVariant"("id") ON DELETE RESTRICT,
 "lotId" TEXT NOT NULL REFERENCES "InventoryLot"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PhysicalLotBarcode_code_check" CHECK ("code" ~ '^CRL[0-9]{10}$'),
 CONSTRAINT "PhysicalLotBarcode_variantId_lotId_key" UNIQUE ("variantId","lotId")
);
CREATE FUNCTION cronox_protect_lot_barcode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Issued identities must be retained'; END IF;
 IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."variantId" IS DISTINCT FROM OLD."variantId" OR NEW."lotId" IS DISTINCT FROM OLD."lotId" THEN
   RAISE EXCEPTION 'Issued identities are immutable';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "PhysicalLotBarcode_identity_guard" BEFORE UPDATE OR DELETE ON "PhysicalLotBarcode"
FOR EACH ROW EXECUTE FUNCTION cronox_protect_lot_barcode();
ALTER TABLE "PhysicalLotBarcode" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PhysicalLotBarcode" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "PhysicalLotBarcode" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "PhysicalLotBarcode" FROM authenticated; END IF;
END $$;
