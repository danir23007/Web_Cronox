-- Existing purchases remain included; only customer manual orders are eligible.
ALTER TABLE "Order" ADD COLUMN "excludedFromStatistics" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD CONSTRAINT "manual_statistics_only" CHECK (NOT "excludedFromStatistics" OR source = 'IN_PERSON_ADMIN');
ALTER TABLE "AuditLog" ADD COLUMN "requestKey" VARCHAR(100);
CREATE UNIQUE INDEX "AuditLog_requestKey_key" ON "AuditLog"("requestKey");
-- Capture the choice in permanent finance history without rewriting prices/costs
-- or old revisions. Missing flags in existing/deleted archives mean inclusion.
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
      jsonb_build_object('unitCostCents',f."unitCostCents",'productName',f."productName",'imageUrl',f."imageUrl") END) ORDER BY i.id),'[]'::jsonb)
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

