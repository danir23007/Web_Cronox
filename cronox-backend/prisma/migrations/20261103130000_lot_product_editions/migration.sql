ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "activeLotId" TEXT;
ALTER TABLE "InventoryLot" ADD COLUMN IF NOT EXISTS number INTEGER;
ALTER TABLE "InventoryLot" ADD COLUMN IF NOT EXISTS profile JSONB;
ALTER TABLE "InventoryLot" ADD COLUMN IF NOT EXISTS "profilePending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "lotAtAdd" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLot_product_number" ON "InventoryLot"("productId",number);
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryLot_product_id" ON "InventoryLot"("productId",id);

CREATE OR REPLACE FUNCTION cronox_lot_profile(pid INTEGER) RETURNS JSONB LANGUAGE sql AS $$
 SELECT (to_jsonb(p)-ARRAY['id','slug','isActive','displayOrder','createdAt','updatedAt','lotManaged','activeLotId','searchText']) || jsonb_build_object(
 'categoryIds',COALESCE((SELECT jsonb_agg("categoryId" ORDER BY "categoryId") FROM "ProductCategory" WHERE "productId"=pid),'[]'),
 'images',COALESCE((SELECT jsonb_agg(to_jsonb(i)-ARRAY['productId','createdAt','updatedAt'] ORDER BY "sortOrder",id) FROM "ProductImage" i WHERE "productId"=pid),'[]'),
 'variants',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'size',size,'sku',sku,'price',price,'isActive',"isActive") ORDER BY id) FROM "ProductVariant" WHERE "productId"=pid),'[]'),
 'unitCostCents',(SELECT "unitCostCents" FROM "ProductCost" WHERE "productId"=pid)) FROM "Product" p WHERE id=pid
$$;

-- Called at commit for new products, and once for existing products. This is
-- an observed balance, not a second receipt. Old sales/cost snapshots stay intact.
CREATE OR REPLACE FUNCTION cronox_ensure_product_edition(pid INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE p RECORD; lid TEXT; variant_row RECORD; r RECORD; sid TEXT; n INTEGER;
BEGIN
 SELECT * INTO p FROM "Product" WHERE id=pid FOR UPDATE;
 IF p.id IS NULL OR p."activeLotId" IS NOT NULL THEN RETURN; END IF;
 PERFORM id FROM "ProductVariant" WHERE "productId"=pid ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM "ProductVariant" WHERE "productId"=pid AND stock<0) THEN RAISE EXCEPTION 'CONCILIATE_NEGATIVE_STOCK product %',pid; END IF;
 IF NOT EXISTS(SELECT 1 FROM "InventoryLot" WHERE "productId"=pid) THEN
   lid := 'initial-edition:'||pid;
   INSERT INTO "InventoryLot" (id,"productId",name,"costQuality","openingBalance","requestKey","requestHash",number,profile)
   VALUES(lid,pid,'Lote 1','UNKNOWN',true,lid,lid,1,cronox_lot_profile(pid));
   FOR variant_row IN SELECT * FROM "ProductVariant" WHERE "productId"=pid ORDER BY id LOOP
     sid := lid||':variant:'||variant_row.id;
     INSERT INTO "InventoryLotSlice" (id,"lotId","variantId",received,available)
     VALUES(sid,lid,variant_row.id,variant_row.stock+(SELECT COALESCE(sum(quantity),0) FROM "CheckoutStockReservation" WHERE "variantId"=variant_row.id AND status='RESERVED'),variant_row.stock);
     FOR r IN SELECT * FROM "CheckoutStockReservation" WHERE "variantId"=variant_row.id AND status='RESERVED' LOOP
       INSERT INTO "InventoryLotAllocation" (id,"sliceId","sourceKey",quantity,state,"costQuality")
       VALUES('initial-reservation:'||r.id,sid,'checkout:'||r."checkoutSnapshotId",r.quantity,'RESERVED','UNKNOWN');
     END LOOP;
   END LOOP;
 ELSE
   n := 0;
   FOR r IN SELECT * FROM "InventoryLot" WHERE "productId"=pid ORDER BY "receivedAt" NULLS FIRST,"createdAt",id LOOP
     n := n+1;
     UPDATE "InventoryLot" SET number=n,profile=COALESCE(profile,cronox_lot_profile(pid)),"profilePending"=true WHERE id=r.id;
     IF n=1 THEN lid := r.id; END IF;
   END LOOP;
 END IF;
 UPDATE "Product" SET "activeLotId"=lid,"lotManaged"=true WHERE id=pid;
 UPDATE "ProductVariant" v SET stock=(SELECT COALESCE(sum(available),0) FROM "InventoryLotSlice" WHERE "variantId"=v.id AND "lotId"=lid) WHERE "productId"=pid;
 INSERT INTO "InventoryLotAudit" (id,"lotId",reason,after) VALUES('edition-migration:'||pid,lid,'Ficha vigente conservada; otras fichas históricas no reconstruibles quedan pendientes',jsonb_build_object('activeLotId',lid,'stockDuplicated',false));
END $$;

CREATE OR REPLACE FUNCTION cronox_assert_lot_stock() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE vid INTEGER; expected BIGINT; actual INTEGER; managed BOOLEAN; lid TEXT;
BEGIN
 IF TG_TABLE_NAME='ProductVariant' THEN vid:=COALESCE(NEW.id,OLD.id); ELSE vid:=COALESCE(NEW."variantId",OLD."variantId"); END IF;
 SELECT v.stock,p."lotManaged",p."activeLotId" INTO actual,managed,lid FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE v.id=vid;
 IF managed THEN
   SELECT COALESCE(sum(available),0) INTO expected FROM "InventoryLotSlice" WHERE "variantId"=vid AND (lid IS NULL OR "lotId"=lid);
   IF expected<>actual THEN RAISE EXCEPTION 'LOT_STOCK_MISMATCH variant %',vid USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION cronox_check_lot_activation() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p RECORD;
BEGIN
 SELECT * INTO p FROM "Product" WHERE id=NEW.id;
 IF p.id IS NULL THEN RETURN NULL; END IF;
 IF p."activeLotId" IS NULL OR NOT p."lotManaged" THEN RAISE EXCEPTION 'EXACTLY_ONE_ACTIVE_LOT_REQUIRED' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM "InventoryLot" WHERE id=p."activeLotId" AND "productId"=p.id AND number IS NOT NULL AND profile IS NOT NULL) THEN RAISE EXCEPTION 'ACTIVE_LOT_PRODUCT_MISMATCH' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "ProductVariant" v WHERE v."productId"=p.id AND v.stock<>(SELECT COALESCE(sum(s.available),0) FROM "InventoryLotSlice" s WHERE s."variantId"=v.id AND s."lotId"=p."activeLotId")) THEN RAISE EXCEPTION 'LOT_STOCK_MISMATCH_ON_ACTIVATION' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE OR REPLACE FUNCTION cronox_initial_edition_trigger() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN PERFORM cronox_ensure_product_edition(NEW.id); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS product_initial_edition ON "Product";
CREATE CONSTRAINT TRIGGER product_initial_edition AFTER INSERT ON "Product" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cronox_initial_edition_trigger();
DO $$ DECLARE p RECORD; BEGIN FOR p IN SELECT id FROM "Product" ORDER BY id LOOP PERFORM cronox_ensure_product_edition(p.id); END LOOP; END $$;
UPDATE "CartItem" c SET "lotAtAdd"=p."activeLotId" FROM "ProductVariant" v JOIN "Product" p ON p.id=v."productId" WHERE c."variantId"=v.id AND c."lotAtAdd" IS NULL;
SET CONSTRAINTS ALL IMMEDIATE;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='Product_activeLot_owner_fk') THEN
 ALTER TABLE "Product" ADD CONSTRAINT "Product_activeLot_owner_fk" FOREIGN KEY(id,"activeLotId") REFERENCES "InventoryLot"("productId",id) DEFERRABLE INITIALLY DEFERRED;
END IF; END $$;

SET CONSTRAINTS ALL DEFERRED;

-- Future legacy-return/adjustment lots must also have stable tabs. Their
-- commercial history is explicitly unknown, rather than claimed reconstructed.
CREATE OR REPLACE FUNCTION cronox_number_lot_edition() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.number IS NULL AND EXISTS(SELECT 1 FROM "Product" WHERE id=NEW."productId" AND "activeLotId" IS NOT NULL) THEN
   PERFORM id FROM "Product" WHERE id=NEW."productId" FOR UPDATE;
   SELECT COALESCE(max(number),0)+1 INTO NEW.number FROM "InventoryLot" WHERE "productId"=NEW."productId";
   NEW.profile := COALESCE(NEW.profile,cronox_lot_profile(NEW."productId"));
   NEW."profilePending" := true;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lot_edition_number ON "InventoryLot";
CREATE TRIGGER lot_edition_number BEFORE INSERT ON "InventoryLot" FOR EACH ROW EXECUTE FUNCTION cronox_number_lot_edition();
