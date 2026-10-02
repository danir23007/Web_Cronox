BEGIN;
CREATE TABLE IF NOT EXISTS "VisitorHistoryConfig" (
  "id" INTEGER PRIMARY KEY CHECK ("id" = 1), "startedAt" TIMESTAMPTZ(3) NOT NULL
);
INSERT INTO "VisitorHistoryConfig" VALUES (1, clock_timestamp()) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS "DailyVisitor" (
  "id" TEXT PRIMARY KEY, "day" DATE NOT NULL,
  "category" TEXT NOT NULL CHECK ("category" IN ('authenticated','anonymous')),
  "identity" TEXT NOT NULL, "userId" INTEGER REFERENCES "User"("id") ON DELETE SET NULL,
  "firstAt" TIMESTAMPTZ(3) NOT NULL, "lastAt" TIMESTAMPTZ(3) NOT NULL,
  CHECK ("firstAt" <= "lastAt"), UNIQUE ("day", "category", "identity")
);
CREATE INDEX IF NOT EXISTS "DailyVisitor_day_category_firstAt_id_idx" ON "DailyVisitor" ("day", "category", "firstAt", "id");
CREATE INDEX IF NOT EXISTS "DailyVisitor_day_firstAt_id_idx" ON "DailyVisitor" ("day", "firstAt", "id");
CREATE INDEX IF NOT EXISTS "DailyVisitor_userId_idx" ON "DailyVisitor" ("userId");

CREATE TABLE IF NOT EXISTS "FinanceArchive" (
  "orderId" INTEGER PRIMARY KEY, "currency" TEXT NOT NULL, "paidDate" DATE NOT NULL,
  "lastDate" DATE NOT NULL, "uncertain" BOOLEAN NOT NULL DEFAULT FALSE,
  "providerRef" TEXT UNIQUE, "snapshot" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS "FinanceArchive_currency_paidDate_orderId_idx" ON "FinanceArchive" ("currency", "paidDate", "orderId");
CREATE INDEX IF NOT EXISTS "FinanceArchive_currency_lastDate_orderId_idx" ON "FinanceArchive" ("currency", "lastDate", "orderId");
CREATE INDEX IF NOT EXISTS "FinanceArchive_currency_orderId_idx" ON "FinanceArchive" ("currency", "orderId");
CREATE TABLE IF NOT EXISTS "FinanceArchiveRevision" (
  "orderId" INTEGER NOT NULL, "revision" INTEGER NOT NULL, "snapshot" JSONB NOT NULL,
  "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(), PRIMARY KEY ("orderId", "revision")
);
CREATE TABLE IF NOT EXISTS "FinanceEventArchive" (
  "id" TEXT PRIMARY KEY, "paymentIntentId" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "snapshot" JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS "FinanceEventArchive_paymentIntentId_occurredAt_idx" ON "FinanceEventArchive" ("paymentIntentId", "occurredAt");
CREATE TABLE IF NOT EXISTS "FinanceStockArchive" (
  "id" TEXT PRIMARY KEY, "orderId" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL, "snapshot" JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS "FinanceStockArchive_orderId_createdAt_idx" ON "FinanceStockArchive" ("orderId", "createdAt");

-- Independent dated facts. Provider event IDs/stock IDs enforce exactly-once capture.
-- No addresses, names/emails of customers, tokens, webhook bodies or stock notes.
CREATE OR REPLACE FUNCTION cronox_capture_finance_event() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = 'PROCESSED' AND NEW."type" IN ('payment_intent.succeeded','charge.refunded','charge.dispute.closed') THEN
    INSERT INTO "FinanceEventArchive" VALUES (NEW.id, NEW."paymentIntentId", NEW."occurredAt",
      jsonb_build_object('id',NEW.id,'type',NEW.type,'paymentIntentId',NEW."paymentIntentId",'occurredAt',NEW."occurredAt",
        'lifecycleStatus',NEW."lifecycleStatus",'refundCumulativeCents',NEW."refundCumulativeCents",'amountCents',NEW."amountCents"))
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION cronox_capture_finance_stock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."orderId" IS NOT NULL AND NEW.delta > 0 AND NEW.reason IN ('refund','manual_sale_void') THEN
    INSERT INTO "FinanceStockArchive" VALUES (NEW.id, NEW."orderId", NEW."createdAt",
      jsonb_build_object('variantId',NEW."variantId",'delta',NEW.delta,'reason',NEW.reason,'createdAt',NEW."createdAt"))
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

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
    doc := jsonb_build_object('historicalQualified',true,'id',o.id,'status',o.status,'currency',o.currency,'providerRef',o."providerRef",'source',o.source,
      'paidAt',o."paidAt",'purchasedAt',o."purchasedAt",'createdAt',o."createdAt",'voidedAt',o."voidedAt",
      'total',o.total::text,'shippingCost',o."shippingCost",'discountCents',o."discountCents",'disputeLostCents',o."disputeLostCents",'items',items);
  ELSE
    -- Preserve original sale amounts, quantities, identity of products and costs.
    -- Fulfillment/refund state is a separate revision; deleting source rows changes nothing.
    doc := prev.snapshot;
    paid := (prev."paidDate"::text || 'T12:00:00')::timestamp;
    IF o.id IS NOT NULL THEN doc := doc || jsonb_build_object('status',o.status,'voidedAt',o."voidedAt",'disputeLostCents',o."disputeLostCents"); END IF;
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

CREATE OR REPLACE FUNCTION cronox_defer_finance_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE oid INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'Order' THEN oid := COALESCE(NEW.id,OLD.id);
  ELSIF TG_TABLE_NAME = 'OrderItemFinancial' THEN SELECT "orderId" INTO oid FROM "OrderItem" WHERE id = COALESCE(NEW."itemId",OLD."itemId");
  ELSIF TG_TABLE_NAME = 'StripeWebhookEvent' THEN
    SELECT id INTO oid FROM "Order" WHERE "providerRef" = COALESCE(NEW."paymentIntentId",OLD."paymentIntentId");
    IF oid IS NULL THEN SELECT "orderId" INTO oid FROM "FinanceArchive" WHERE "providerRef" = COALESCE(NEW."paymentIntentId",OLD."paymentIntentId"); END IF;
  ELSE oid := COALESCE(NEW."orderId",OLD."orderId"); END IF;
  IF oid IS NOT NULL THEN PERFORM cronox_capture_finance_order(oid); END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

DROP TRIGGER IF EXISTS finance_event_fact ON "StripeWebhookEvent";
CREATE TRIGGER finance_event_fact AFTER INSERT OR UPDATE ON "StripeWebhookEvent" FOR EACH ROW EXECUTE FUNCTION cronox_capture_finance_event();
DROP TRIGGER IF EXISTS finance_stock_fact ON "StockMovement";
CREATE TRIGGER finance_stock_fact AFTER INSERT OR UPDATE ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION cronox_capture_finance_stock();
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['Order','OrderItem','OrderItemFinancial','StockMovement','StripeWebhookEvent'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS finance_deferred_capture ON %I',t);
    EXECUTE format('CREATE CONSTRAINT TRIGGER finance_deferred_capture AFTER INSERT OR UPDATE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cronox_defer_finance_capture()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['Order','OrderItem','OrderItemFinancial'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS finance_before_delete ON %I',t);
    EXECUTE format('CREATE TRIGGER finance_before_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION cronox_defer_finance_capture()',t);
  END LOOP;
END $$;

-- Backfill only surviving evidence. Replay is safe; no fake costs/events/dates.
INSERT INTO "FinanceEventArchive"
  SELECT id,"paymentIntentId","occurredAt",jsonb_build_object('id',id,'type',type,'paymentIntentId',"paymentIntentId",'occurredAt',"occurredAt",
    'lifecycleStatus',"lifecycleStatus",'refundCumulativeCents',"refundCumulativeCents",'amountCents',"amountCents")
  FROM "StripeWebhookEvent" WHERE status = 'PROCESSED' AND type IN ('payment_intent.succeeded','charge.refunded','charge.dispute.closed') ON CONFLICT DO NOTHING;
INSERT INTO "FinanceStockArchive"
  SELECT id,"orderId","createdAt",jsonb_build_object('variantId',"variantId",'delta',delta,'reason',reason,'createdAt',"createdAt")
  FROM "StockMovement" WHERE "orderId" IS NOT NULL AND delta > 0 AND reason IN ('refund','manual_sale_void') ON CONFLICT DO NOTHING;
DO $$ DECLARE oid INTEGER; BEGIN FOR oid IN SELECT id FROM "Order" ORDER BY id LOOP PERFORM cronox_capture_finance_order(oid); END LOOP; END $$;

-- Deleting an account retains counts but removes its link AND deduplication identity.
CREATE OR REPLACE FUNCTION cronox_anonymize_visits() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "DailyVisitor" SET "userId" = NULL, identity = 'deleted:' || id WHERE "userId" = OLD.id;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS anonymize_visitor_history ON "User";
CREATE TRIGGER anonymize_visitor_history BEFORE DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION cronox_anonymize_visits();

CREATE OR REPLACE FUNCTION cronox_protect_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Permanent history cannot be deleted, truncated or rewritten'; END $$;
DO $$ DECLARE t TEXT; r TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['DailyVisitor','VisitorHistoryConfig','FinanceArchive','FinanceArchiveRevision','FinanceEventArchive','FinanceStockArchive'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON %I FROM %I',t,r); END IF;
    END LOOP;
    EXECUTE format('DROP TRIGGER IF EXISTS history_no_delete ON %I',t);
    EXECUTE format('CREATE TRIGGER history_no_delete BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION cronox_protect_history()',t);
    EXECUTE format('DROP TRIGGER IF EXISTS history_no_truncate ON %I',t);
    EXECUTE format('CREATE TRIGGER history_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION cronox_protect_history()',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['VisitorHistoryConfig','FinanceArchiveRevision','FinanceEventArchive','FinanceStockArchive'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS history_no_update ON %I',t);
    EXECUTE format('CREATE TRIGGER history_no_update BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION cronox_protect_history()',t);
  END LOOP;
END $$;
COMMIT;
