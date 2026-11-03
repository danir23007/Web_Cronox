-- Additive schema only. Existing balances are imported by the reviewed,
-- repeatable reconciliation procedure, never by guessing historical receipts.
CREATE TABLE "InventoryLot" (
  id TEXT PRIMARY KEY,
  "productId" INTEGER NOT NULL REFERENCES "Product"(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  "receivedAt" TIMESTAMP(3),
  notes VARCHAR(2000) NOT NULL DEFAULT '',
  "referencePriceCents" INTEGER CHECK ("referencePriceCents" >= 0),
  "freightTotalCents" INTEGER CHECK ("freightTotalCents" >= 0),
  "otherTotalCents" INTEGER CHECK ("otherTotalCents" >= 0),
  "costQuality" TEXT NOT NULL CHECK ("costQuality" IN ('CONFIRMED','ESTIMATED','UNKNOWN')),
  "allocationRule" TEXT NOT NULL DEFAULT 'PER_UNIT' CHECK ("allocationRule" = 'PER_UNIT'),
  "openingBalance" BOOLEAN NOT NULL DEFAULT false,
  archived BOOLEAN NOT NULL DEFAULT false,
  revision INTEGER NOT NULL DEFAULT 1,
  "requestKey" TEXT NOT NULL UNIQUE,
  "requestHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InventoryLot_productId_idx" ON "InventoryLot"("productId");
CREATE TABLE "InventoryLotSlice" (
  id TEXT PRIMARY KEY,
  "lotId" TEXT NOT NULL REFERENCES "InventoryLot"(id) ON DELETE RESTRICT,
  "variantId" INTEGER NOT NULL REFERENCES "ProductVariant"(id) ON DELETE RESTRICT,
  received INTEGER NOT NULL CHECK (received >= 0),
  available INTEGER NOT NULL CHECK (available >= 0 AND available <= received),
  "productionCents" INTEGER CHECK ("productionCents" >= 0),
  "freightCents" INTEGER CHECK ("freightCents" >= 0),
  "otherCents" INTEGER CHECK ("otherCents" >= 0)
);
CREATE INDEX "InventoryLotSlice_variantId_idx" ON "InventoryLotSlice"("variantId", "lotId");
CREATE TABLE "InventoryLotAllocation" (
  id TEXT PRIMARY KEY,
  "sliceId" TEXT NOT NULL REFERENCES "InventoryLotSlice"(id) ON DELETE RESTRICT,
  "sourceKey" TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  returned INTEGER NOT NULL DEFAULT 0 CHECK (returned >= 0 AND returned <= quantity),
  retired INTEGER NOT NULL DEFAULT 0 CHECK (retired >= 0 AND retired + returned <= quantity),
  state TEXT NOT NULL CHECK (state IN ('RESERVED','SOLD','RELEASED','ADJUSTED')),
  "productionCents" INTEGER CHECK ("productionCents" >= 0),
  "freightCents" INTEGER CHECK ("freightCents" >= 0),
  "otherCents" INTEGER CHECK ("otherCents" >= 0),
  "costQuality" TEXT NOT NULL CHECK ("costQuality" IN ('CONFIRMED','ESTIMATED','UNKNOWN')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InventoryLotAllocation_source_idx" ON "InventoryLotAllocation"("sourceKey");
CREATE INDEX "InventoryLotAllocation_slice_idx" ON "InventoryLotAllocation"("sliceId");
CREATE TABLE "InventoryLotAudit" (
  id TEXT PRIMARY KEY,
  "lotId" TEXT NOT NULL REFERENCES "InventoryLot"(id) ON DELETE RESTRICT,
  "actorId" INTEGER,
  reason TEXT NOT NULL,
  before JSONB,
  after JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "InventoryLotAudit_lot_idx" ON "InventoryLotAudit"("lotId", "createdAt");
ALTER TABLE "CheckoutItemFinancial" ADD COLUMN "lotCosts" JSONB;
ALTER TABLE "OrderItemFinancial" ADD COLUMN "lotCosts" JSONB;

-- A product becomes managed only after its reviewed opening balances are
-- accepted. This enables deployment before reconciliation, without a mixed
-- counter once activated. Commit-time verification catches every old writer.
ALTER TABLE "Product" ADD COLUMN "lotManaged" BOOLEAN NOT NULL DEFAULT false;
CREATE OR REPLACE FUNCTION cronox_assert_lot_stock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE vid INTEGER; expected BIGINT; actual INTEGER; managed BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'ProductVariant' THEN vid := COALESCE(NEW.id, OLD.id);
  ELSE vid := COALESCE(NEW."variantId", OLD."variantId"); END IF;
  SELECT v.stock, p."lotManaged" INTO actual, managed FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE v.id=vid;
  IF managed THEN
    SELECT COALESCE(sum(available),0) INTO expected FROM "InventoryLotSlice" WHERE "variantId"=vid;
    IF expected <> actual THEN RAISE EXCEPTION 'LOT_STOCK_MISMATCH variant %',vid USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lot_stock_variant AFTER INSERT OR UPDATE OR DELETE ON "ProductVariant" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cronox_assert_lot_stock();
CREATE CONSTRAINT TRIGGER lot_stock_slice AFTER INSERT OR UPDATE OR DELETE ON "InventoryLotSlice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cronox_assert_lot_stock();

-- Preserve lot cost slices in new permanent finance archives; old revisions stay intact.
CREATE OR REPLACE FUNCTION cronox_capture_finance_order(oid INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE o RECORD; prev RECORD; doc JSONB; items JSONB; paid TIMESTAMP; last_day DATE; missing BOOLEAN;
BEGIN
  -- Serialize capture of the same order; rows are complete at the deferred trigger.
  PERFORM pg_advisory_xact_lock(73421, oid);
  SELECT * INTO o FROM "Order" WHERE id = oid;
  SELECT * INTO prev FROM "FinanceArchive" WHERE "orderId" = oid FOR UPDATE;
  IF o.id IS NULL AND prev."orderId" IS NULL THEN RETURN; END IF;
  IF prev."orderId" IS NULL THEN
    IF o."paidAt" IS NULL AND o."purchasedAt" IS NULL AND o.status::text NOT IN ('PAID','PROCESSING','SHIPPED','DELIVERED','REFUNDED','DISPUTED')
      AND NOT EXISTS (SELECT 1 FROM "FinanceEventArchive" WHERE "paymentIntentId" = o."providerRef" AND snapshot->>'type' = 'payment_intent.succeeded') THEN RETURN; END IF;
    paid := COALESCE(o."paidAt", (SELECT MIN("occurredAt") FROM "FinanceEventArchive" WHERE "paymentIntentId" = o."providerRef" AND snapshot->>'type' = 'payment_intent.succeeded'), o."purchasedAt", o."createdAt");
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id',i.id,'productId',i."productId",'variantId',i."variantId",'title',i.title,
      'quantity',i.quantity,'lineTotal',i."lineTotal"::text,'financialSnapshot',CASE WHEN f."itemId" IS NULL THEN NULL ELSE
      jsonb_build_object('unitCostCents',f."unitCostCents",'lotCosts',f."lotCosts",'productName',f."productName",'imageUrl',f."imageUrl") END) ORDER BY i.id),'[]'::jsonb)
      INTO items FROM "OrderItem" i LEFT JOIN "OrderItemFinancial" f ON f."itemId" = i.id WHERE i."orderId" = oid;
    IF jsonb_array_length(items) = 0 THEN RETURN; END IF;
    doc := jsonb_build_object('historicalQualified',true,'id',o.id,'status',o.status,'currency',o.currency,'providerRef',o."providerRef",'source',o.source,'excludedFromStatistics',o."excludedFromStatistics",
      'paidAt',o."paidAt",'purchasedAt',o."purchasedAt",'createdAt',o."createdAt",'voidedAt',o."voidedAt",
      'total',o.total::text,'shippingCost',o."shippingCost",'discountCents',o."discountCents",'disputeLostCents',o."disputeLostCents",'items',items);
  ELSE
    -- Preserve original sale amounts, quantities, identity of products and costs.
    -- Fulfillment/refund state is a separate revision; deleting source rows changes nothing.
    doc := prev.snapshot;
    paid := (prev."paidDate"::text || 'T12:00:00')::timestamp;
    IF o.id IS NOT NULL THEN doc := doc || jsonb_build_object('excludedFromStatistics',o."excludedFromStatistics",'status',o.status,'voidedAt',o."voidedAt",'disputeLostCents',o."disputeLostCents"); END IF;
  END IF;
  SELECT GREATEST((paid AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date,
    (NULLIF(doc->>'voidedAt','')::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date,
    (SELECT MAX("occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date FROM "FinanceEventArchive" WHERE "paymentIntentId" = doc->>'providerRef'),
    (SELECT MAX("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date FROM "FinanceStockArchive" WHERE "orderId" = oid)) INTO last_day;
  missing := (doc->>'status' = 'REFUNDED' AND NOT EXISTS (SELECT 1 FROM "FinanceEventArchive" WHERE "paymentIntentId" = doc->>'providerRef' AND snapshot->>'type' = 'charge.refunded'));
  IF prev."orderId" IS NULL THEN
    INSERT INTO "FinanceArchive" VALUES (oid,doc->>'currency',(paid AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Madrid')::date,last_day,missing,doc->>'providerRef',doc,1);
    INSERT INTO "FinanceArchiveRevision" ("orderId",revision,snapshot) VALUES (oid,1,doc);
  ELSE
    UPDATE "FinanceArchive" SET "lastDate" = GREATEST("lastDate",last_day), uncertain = missing WHERE "orderId" = oid;
    IF doc IS DISTINCT FROM prev.snapshot THEN
      UPDATE "FinanceArchive" SET snapshot = doc, revision = revision + 1 WHERE "orderId" = oid;
      INSERT INTO "FinanceArchiveRevision" ("orderId",revision,snapshot) VALUES (oid,prev.revision + 1,doc);
    END IF;
  END IF;
END $$;

CREATE TABLE "InventoryPointCostRevision" (
  id TEXT PRIMARY KEY,
  "entryId" TEXT NOT NULL REFERENCES "PointEntry"(id) ON DELETE RESTRICT,
  "lineIndex" INTEGER NOT NULL CHECK ("lineIndex" >= 0),
  revision INTEGER NOT NULL CHECK (revision > 0),
  "actorId" INTEGER NOT NULL,
  reason TEXT NOT NULL,
  before JSONB NOT NULL,
  after JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("entryId","lineIndex",revision)
);
