BEGIN;
-- Confirmed in-person sales use purchasedAt rather than paidAt in this project.
-- Backdated sales remain excluded by the per-device activation cutoff.
CREATE OR REPLACE FUNCTION cronox_order_paid_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE paid_time TIMESTAMP(3);
BEGIN
 paid_time := COALESCE(NEW."paidAt", CASE WHEN NEW.source='IN_PERSON_ADMIN' THEN NEW."purchasedAt" END);
 IF NEW.status='PAID' AND paid_time IS NOT NULL AND
 (TG_OP='INSERT' OR OLD."paidAt" IS NULL OR OLD.status='PENDING') THEN
  PERFORM cronox_enqueue_admin_push('paidOrders',NEW.id::text,
   jsonb_build_object('orderId',NEW.id,'total',NEW.total::text,'currency',NEW.currency),paid_time AT TIME ZONE 'UTC');
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
COMMIT;
