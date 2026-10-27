BEGIN;
-- Browser presence is private inventory coordination, never a public Data API.
ALTER TABLE "CheckoutPresence" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "CheckoutPresence" FROM PUBLIC;
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON "CheckoutPresence" FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
COMMIT;
