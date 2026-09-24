-- Additive only. No initial scan, inventory changes, or historical events.
CREATE TABLE "RestockRequest" (
  "id" TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "variantId" INTEGER NOT NULL REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'WAITING' CHECK ("status" IN
    ('WAITING','QUEUED','PROCESSING','ACCEPTED','FAILED','UNCERTAIN','CANCELLED')),
  "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMPTZ(3), "claimedAt" TIMESTAMPTZ(3), "claimToken" TEXT,
  "acceptedAt" TIMESTAMPTZ(3), "attempts" INTEGER NOT NULL DEFAULT 0,
  "errorCode" TEXT
);
CREATE UNIQUE INDEX "RestockRequest_active_user_variant" ON "RestockRequest"("userId","variantId")
 WHERE "status" IN ('WAITING','QUEUED','PROCESSING','FAILED','UNCERTAIN');
CREATE INDEX "RestockRequest_variantId_status_idx" ON "RestockRequest"("variantId","status");
CREATE INDEX "RestockRequest_userId_variantId_requestedAt_idx" ON "RestockRequest"("userId","variantId","requestedAt");
CREATE INDEX "RestockRequest_status_readyAt_idx" ON "RestockRequest"("status","readyAt");
ALTER TABLE "RestockRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RestockRequest" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN REVOKE ALL ON "RestockRequest" FROM anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN REVOKE ALL ON "RestockRequest" FROM authenticated; END IF;
END $$;

-- stock is the available quantity: checkout reservations already subtract it.
-- Observe every writer (individual/bulk/import/return/release) atomically.
-- Five uninterrupted minutes of availability debounces reservation churn.
CREATE FUNCTION cronox_restock_variant_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.size IS DISTINCT FROM NEW.size OR OLD."productId" IS DISTINCT FROM NEW."productId" THEN
    UPDATE "RestockRequest" SET "status"='CANCELLED', "readyAt"=NULL, "errorCode"='VARIANT_CHANGED', "updatedAt"=CURRENT_TIMESTAMP
      WHERE "variantId"=NEW.id AND "status" IN ('WAITING','QUEUED','PROCESSING','FAILED','UNCERTAIN');
    RETURN NEW;
  END IF;
  IF NEW."stock" <= 0 OR NOT NEW."isActive" THEN
    UPDATE "RestockRequest" SET "status"='WAITING', "readyAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP
      WHERE "variantId"=NEW.id AND "status"='QUEUED';
  ELSIF (OLD."stock" <= 0 OR NOT OLD."isActive")
    AND EXISTS (SELECT 1 FROM "Product" WHERE id=NEW."productId" AND "isActive") THEN
    UPDATE "RestockRequest" SET "status"='QUEUED', "readyAt"=CURRENT_TIMESTAMP + interval '5 minutes', "updatedAt"=CURRENT_TIMESTAMP
      WHERE "variantId"=NEW.id AND "status"='WAITING';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cronox_restock_variant AFTER UPDATE OF "stock", "isActive", size, "productId" ON "ProductVariant"
  FOR EACH ROW EXECUTE FUNCTION cronox_restock_variant_transition();

CREATE FUNCTION cronox_restock_product_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."isActive" IS DISTINCT FROM NEW."isActive" THEN
    IF NEW."isActive" THEN
      UPDATE "RestockRequest" r SET "status"='QUEUED', "readyAt"=CURRENT_TIMESTAMP + interval '5 minutes', "updatedAt"=CURRENT_TIMESTAMP
        FROM "ProductVariant" v WHERE r."variantId"=v.id AND v."productId"=NEW.id
        AND v."isActive" AND v.stock>0 AND r.status='WAITING';
    ELSE
      UPDATE "RestockRequest" r SET "status"='WAITING', "readyAt"=NULL, "updatedAt"=CURRENT_TIMESTAMP
        FROM "ProductVariant" v WHERE r."variantId"=v.id AND v."productId"=NEW.id AND r.status='QUEUED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cronox_restock_product AFTER UPDATE OF "isActive" ON "Product"
  FOR EACH ROW EXECUTE FUNCTION cronox_restock_product_transition();
