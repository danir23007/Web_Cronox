-- Templates and their administrator metadata are served exclusively by the
-- guarded backend. Retain that private boundary in the Supabase Data API too.
ALTER TABLE "ManagedEmailTemplate" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "ManagedEmailTemplate" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    REVOKE ALL ON "ManagedEmailTemplate" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    REVOKE ALL ON "ManagedEmailTemplate" FROM authenticated;
  END IF;
END $$;
