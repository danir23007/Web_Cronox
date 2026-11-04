-- Commit-time conservation: available stock plus units still withdrawn equals
-- the documented receipt/opening balance. Transferring an ADJUSTED withdrawal
-- to a sale uses retired only on that adjustment, without a second deduction.
CREATE OR REPLACE FUNCTION cronox_check_lot_slice(sid TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE s RECORD; held BIGINT; lot_product INTEGER; variant_product INTEGER;
BEGIN
  SELECT * INTO s FROM "InventoryLotSlice" WHERE id=sid;
  IF s.id IS NULL THEN RETURN; END IF;
  SELECT "productId" INTO lot_product FROM "InventoryLot" WHERE id=s."lotId";
  SELECT "productId" INTO variant_product FROM "ProductVariant" WHERE id=s."variantId";
  IF lot_product IS DISTINCT FROM variant_product THEN RAISE EXCEPTION 'LOT_VARIANT_PRODUCT_MISMATCH' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(quantity-returned-CASE WHEN state='ADJUSTED' THEN retired ELSE 0 END),0) INTO held FROM "InventoryLotAllocation" WHERE "sliceId"=sid;
  IF s.available+held <> s.received THEN RAISE EXCEPTION 'LOT_QUANTITY_BALANCE_MISMATCH slice %',sid USING ERRCODE='23514'; END IF;
END $$;
CREATE OR REPLACE FUNCTION cronox_defer_lot_balance() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='InventoryLotSlice' THEN
    PERFORM cronox_check_lot_slice(COALESCE(NEW.id,OLD.id));
  ELSE
    IF TG_OP<>'INSERT' THEN PERFORM cronox_check_lot_slice(OLD."sliceId"); END IF;
    IF TG_OP<>'DELETE' THEN PERFORM cronox_check_lot_slice(NEW."sliceId"); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lot_slice_balance AFTER INSERT OR UPDATE OR DELETE ON "InventoryLotSlice" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cronox_defer_lot_balance();
CREATE CONSTRAINT TRIGGER lot_allocation_balance AFTER INSERT OR UPDATE OR DELETE ON "InventoryLotAllocation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cronox_defer_lot_balance();
CREATE OR REPLACE FUNCTION cronox_check_lot_activation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."lotManaged" AND NOT NEW."lotManaged" THEN RAISE EXCEPTION 'LOT_MANAGEMENT_CANNOT_BE_DISABLED' USING ERRCODE='23514'; END IF;
  IF NEW."lotManaged" AND EXISTS(SELECT 1 FROM "ProductVariant" v WHERE v."productId"=NEW.id AND v.stock<>(SELECT COALESCE(sum(s.available),0) FROM "InventoryLotSlice" s WHERE s."variantId"=v.id)) THEN RAISE EXCEPTION 'LOT_STOCK_MISMATCH_ON_ACTIVATION' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER lot_product_activation AFTER UPDATE ON "Product" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cronox_check_lot_activation();
