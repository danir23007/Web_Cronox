-- Private security state is accessible through the backend, never the public Data API.
ALTER TABLE "EmailChangeRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "EmailChangeRequest" FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "EmailChangeRequest" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "EmailChangeRequest" FROM authenticated;
  END IF;
END $$;
