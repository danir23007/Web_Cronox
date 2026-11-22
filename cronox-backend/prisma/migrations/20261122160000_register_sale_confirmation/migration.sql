CREATE TABLE "RegisterSale" (
 "key" VARCHAR(100) PRIMARY KEY,
 "requestHash" VARCHAR(64) NOT NULL,
 "orderId" INTEGER NOT NULL UNIQUE REFERENCES "Order"(id) ON DELETE RESTRICT,
 "paymentMethod" TEXT NOT NULL CHECK ("paymentMethod" IN ('EXTERNAL_STRIPE','BIZUM','CASH')),
 "paymentChannel" TEXT NOT NULL CHECK ("paymentChannel" IN ('STRIPE_CONTACTLESS_EXTERNAL','BIZUM_EXTERNAL','CASH_RECEIVED')),
 "confirmationMode" TEXT NOT NULL DEFAULT 'MANUAL_RECEIVED' CHECK ("confirmationMode"='MANUAL_RECEIVED'),
 "confirmedById" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "pointId" TEXT REFERENCES "SalePoint"(id) ON DELETE RESTRICT,
 "receipt" JSONB NOT NULL
);
CREATE INDEX "RegisterSale_confirmedAt_pointId_idx" ON "RegisterSale"("confirmedAt","pointId");
CREATE FUNCTION cronox_retain_register_sale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Register confirmations are immutable'; END;
$$;
CREATE TRIGGER "RegisterSale_immutable" BEFORE UPDATE OR DELETE ON "RegisterSale"
FOR EACH ROW EXECUTE FUNCTION cronox_retain_register_sale();
ALTER TABLE "RegisterSale" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RegisterSale" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "RegisterSale" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "RegisterSale" FROM authenticated; END IF;
END $$;
