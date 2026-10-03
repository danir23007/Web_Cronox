BEGIN;
-- Prisma timestamps without time zone store UTC. Never interpret paidAt using
-- PostgreSQL's server timezone when comparing with device activation instants.
CREATE OR REPLACE FUNCTION cronox_order_paid_push() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status='PAID' AND NEW."paidAt" IS NOT NULL AND
 (TG_OP='INSERT' OR OLD."paidAt" IS NULL OR OLD.status='PENDING') THEN
  PERFORM cronox_enqueue_admin_push('paidOrders',NEW.id::text,
   jsonb_build_object('orderId',NEW.id,'total',NEW.total::text,'currency',NEW.currency),NEW."paidAt" AT TIME ZONE 'UTC');
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
COMMIT;
