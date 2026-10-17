ALTER TABLE "User" ADD COLUMN "circle2PromotedAt" TIMESTAMP(3);

CREATE TABLE "CircleReconciliationQueue" (
  "userId" INTEGER PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "CircleReconciliationQueue" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CircleReconciliationQueue" FROM PUBLIC;

-- A persisted date is never reset by subsequent purchases, manual edits or retries.
-- Legacy circle-II members remain null until evidence is reviewed explicitly.
CREATE FUNCTION cronox_preserve_circle2_date() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."circle2PromotedAt" IS NOT NULL THEN
    NEW."circle2PromotedAt" := OLD."circle2PromotedAt";
  ELSIF OLD."circleLevel" = 1 AND NEW."circleLevel" = 2 AND NEW."circle2PromotedAt" IS NULL THEN
    NEW."circle2PromotedAt" := CURRENT_TIMESTAMP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER circle2_effective_date BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION cronox_preserve_circle2_date();

CREATE FUNCTION cronox_enqueue_circle_reconciliation(uid INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM "User" WHERE id=uid) THEN RETURN; END IF;
  INSERT INTO "CircleReconciliationQueue" ("userId") VALUES (uid)
  ON CONFLICT ("userId") DO UPDATE SET version="CircleReconciliationQueue".version+1,"queuedAt"=CURRENT_TIMESTAMP;
END $$;

CREATE FUNCTION cronox_circle_purchase_changed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE uid INTEGER;
BEGIN
  IF TG_TABLE_NAME='Order' THEN
    IF TG_OP <> 'INSERT' THEN PERFORM cronox_enqueue_circle_reconciliation(OLD."userId"); END IF;
    IF TG_OP <> 'DELETE' AND (TG_OP='INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId") THEN
      PERFORM cronox_enqueue_circle_reconciliation(NEW."userId");
    END IF;
  ELSIF TG_TABLE_NAME='FinanceEventArchive' THEN
    FOR uid IN SELECT "userId" FROM "Order" WHERE "providerRef"=NEW."paymentIntentId" LOOP
      PERFORM cronox_enqueue_circle_reconciliation(uid);
    END LOOP;
  ELSE
    SELECT "userId" INTO uid FROM "Order" WHERE id=NEW."orderId";
    PERFORM cronox_enqueue_circle_reconciliation(uid);
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;

-- Finance snapshots are captured by existing deferred triggers. The queue is
-- committed with those snapshots and the worker reads only committed evidence.
CREATE TRIGGER circle_finance_changed AFTER INSERT OR UPDATE ON "FinanceArchive"
  FOR EACH ROW EXECUTE FUNCTION cronox_circle_purchase_changed();
CREATE TRIGGER circle_finance_event_changed AFTER INSERT OR UPDATE ON "FinanceEventArchive"
  FOR EACH ROW EXECUTE FUNCTION cronox_circle_purchase_changed();
CREATE TRIGGER circle_order_owner_changed AFTER INSERT OR UPDATE OR DELETE ON "Order"
  FOR EACH ROW EXECUTE FUNCTION cronox_circle_purchase_changed();
