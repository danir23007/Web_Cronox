ALTER TABLE "NewsletterMailJob"
  ADD COLUMN "previousCircle" INTEGER,
  ADD COLUMN "promotedCircle" INTEGER,
  DROP CONSTRAINT "NewsletterMailJob_kind_check",
  ADD CONSTRAINT "NewsletterMailJob_kind_check"
    CHECK ("kind" IN ('WELCOME', 'ACCESS', 'CIRCLE_PROMOTION'));

-- Record prospective promotions in the same transaction as the membership.
CREATE FUNCTION enqueue_circle_promotion_email() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "NewsletterMailJob" (
    "id", "email", "kind", "userId", "previousCircle", "promotedCircle", "updatedAt"
  ) VALUES (
    gen_random_uuid()::text, lower(trim(NEW."email")), 'CIRCLE_PROMOTION',
    NEW."id", OLD."circleLevel", NEW."circleLevel", CURRENT_TIMESTAMP
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_circle_promotion_email
AFTER UPDATE OF "circleLevel" ON "User"
FOR EACH ROW WHEN (
  NEW."circleLevel" > OLD."circleLevel"
  AND NEW."circleLevel" BETWEEN 2 AND 5
  AND NEW."accountState" = 'ACTIVE'
  AND trim(NEW."email") <> ''
)
EXECUTE FUNCTION enqueue_circle_promotion_email();
