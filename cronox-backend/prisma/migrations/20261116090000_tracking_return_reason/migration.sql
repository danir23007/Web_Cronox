-- Preserve only the reason description supplied on the triggering return event.
-- Existing events intentionally remain NULL; no inference or historical backfill.
ALTER TABLE "OrderTrackingEvent" ADD COLUMN "returnReason" TEXT;
