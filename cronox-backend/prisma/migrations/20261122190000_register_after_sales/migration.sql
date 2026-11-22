CREATE TABLE "AfterSaleOperation" (
 "key" VARCHAR(80) PRIMARY KEY, "requestHash" VARCHAR(64) NOT NULL,
 "kind" TEXT NOT NULL CHECK("kind" IN ('RETURN','EXCHANGE')),
 "orderId" INTEGER NOT NULL REFERENCES "Order"(id) ON DELETE RESTRICT,
 "userId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "actorId" INTEGER NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "pointId" TEXT REFERENCES "SalePoint"(id) ON DELETE RESTRICT,
 "refundCents" INTEGER NOT NULL DEFAULT 0 CHECK("refundCents">=0), "taxCents" INTEGER NOT NULL DEFAULT 0,
 "paymentMethod" TEXT, "externalReference" TEXT UNIQUE,
 "restock" BOOLEAN NOT NULL, "reason" TEXT NOT NULL, "lines" JSONB NOT NULL, "receipt" JSONB NOT NULL
);
CREATE INDEX "AfterSaleOperation_orderId_occurredAt_idx" ON "AfterSaleOperation"("orderId","occurredAt");
CREATE INDEX "AfterSaleOperation_userId_occurredAt_idx" ON "AfterSaleOperation"("userId","occurredAt");
CREATE TABLE "AfterSaleUnit" (
 "id" TEXT PRIMARY KEY, "itemId" INTEGER NOT NULL REFERENCES "OrderItem"(id) ON DELETE RESTRICT,
 "ordinal" INTEGER NOT NULL CHECK("ordinal">=0), "variantId" INTEGER NOT NULL REFERENCES "ProductVariant"(id) ON DELETE RESTRICT,
 "lotId" TEXT NOT NULL REFERENCES "InventoryLot"(id) ON DELETE RESTRICT,
 "valueCents" INTEGER NOT NULL CHECK("valueCents">=0), "costParts" JSONB NOT NULL,
 "sourceKey" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'HELD' CHECK("state" IN ('HELD','RETURNED')),
 "version" INTEGER NOT NULL DEFAULT 0,
 UNIQUE("itemId","ordinal")
);
CREATE TRIGGER "AfterSaleOperation_immutable" BEFORE UPDATE OR DELETE ON "AfterSaleOperation"
FOR EACH ROW EXECUTE FUNCTION cronox_retain_register_sale();
ALTER TABLE "AfterSaleOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AfterSaleUnit" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "AfterSaleOperation","AfterSaleUnit" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON "AfterSaleOperation","AfterSaleUnit" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON "AfterSaleOperation","AfterSaleUnit" FROM authenticated; END IF;
END $$;

-- Coordinate legacy adjustments with the same order lock used by CAJA.
CREATE FUNCTION cronox_guard_after_sale_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE oid integer;
BEGIN
 IF TG_TABLE_NAME='Order' THEN oid:=NEW.id;
 ELSIF TG_TABLE_NAME='OrderItem' THEN oid:=COALESCE(NEW."orderId",OLD."orderId");
 ELSE SELECT "orderId" INTO oid FROM "PointSale" WHERE id=NEW."saleId"; END IF;
 IF oid IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
 PERFORM id FROM "Order" WHERE id=oid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "AfterSaleOperation" WHERE "orderId"=oid) THEN
   IF TG_TABLE_NAME='OrderItem' THEN RAISE EXCEPTION 'AFTER_SALE_RECONCILIATION_REQUIRED';
   ELSIF TG_TABLE_NAME='Order' THEN
     IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status::text IN ('REFUNDED','CANCELLED') THEN RAISE EXCEPTION 'AFTER_SALE_RECONCILIATION_REQUIRED'; END IF;
   ELSE
     IF NOT (COALESCE(NEW.after,'{}'::jsonb) ? 'afterSaleKey') THEN RAISE EXCEPTION 'AFTER_SALE_RECONCILIATION_REQUIRED'; END IF;
   END IF;
 END IF;
 RETURN COALESCE(NEW,OLD);
END;
$$;
CREATE TRIGGER "Order_after_sale_guard" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION cronox_guard_after_sale_order();
CREATE TRIGGER "OrderItem_after_sale_guard" BEFORE INSERT OR UPDATE OR DELETE ON "OrderItem" FOR EACH ROW EXECUTE FUNCTION cronox_guard_after_sale_order();
CREATE TRIGGER "PointEntry_after_sale_guard" BEFORE INSERT ON "PointEntry" FOR EACH ROW EXECUTE FUNCTION cronox_guard_after_sale_order();
