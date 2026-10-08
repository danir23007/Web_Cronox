BEGIN;
-- Runs before User_preserve_identity, which inserts the new reservation.
-- Also reject an explicit attempt to recreate a deleted primary key.
CREATE FUNCTION reject_reserved_user_id() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "UserIdentityReservation" WHERE "userId" = NEW.id) THEN
    RAISE EXCEPTION 'User identity has already been reserved; deleted identities cannot be recreated';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "User_check_reserved_id" BEFORE INSERT ON "User"
  FOR EACH ROW EXECUTE FUNCTION reject_reserved_user_id();
REVOKE ALL ON FUNCTION reject_reserved_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION preserve_user_identity() FROM PUBLIC;
COMMIT;
