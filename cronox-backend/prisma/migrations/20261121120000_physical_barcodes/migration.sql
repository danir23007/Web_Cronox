CREATE TABLE "PhysicalBarcode" (
    "code" VARCHAR(13) NOT NULL,
    "variantId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PhysicalBarcode_pkey" PRIMARY KEY ("code"),
    CONSTRAINT "PhysicalBarcode_code_check" CHECK ("code" ~ '^CRX[0-9]{10}$')
);
CREATE UNIQUE INDEX "PhysicalBarcode_variantId_key" ON "PhysicalBarcode"("variantId");
ALTER TABLE "PhysicalBarcode" ADD CONSTRAINT "PhysicalBarcode_variantId_fkey"
    FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Issued identities cannot be renamed, reassigned, or reused after retirement.
CREATE FUNCTION cronox_protect_physical_barcode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Issued CRONOX barcode identities must be retained';
  END IF;
  IF NEW."code" IS DISTINCT FROM OLD."code" OR
     (NEW."variantId" IS DISTINCT FROM OLD."variantId" AND NEW."variantId" IS NOT NULL) THEN
    RAISE EXCEPTION 'Issued CRONOX barcode identities are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "PhysicalBarcode_identity_guard" BEFORE UPDATE OR DELETE ON "PhysicalBarcode"
FOR EACH ROW EXECUTE FUNCTION cronox_protect_physical_barcode();
