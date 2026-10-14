BEGIN;
-- Stop all old writers before applying. Old enum literals must fail, never be aliased.
LOCK TABLE "User" IN ACCESS EXCLUSIVE MODE;
LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE account_state_plan ON COMMIT DROP AS
WITH evidence AS (
  SELECT u.id, u."identityUid", u.role::text AS role,
    u."accountState"::text AS before, u."updatedAt",
    a.metadata->'after'->>'accountState' AS admin_state,
    CASE WHEN r.metadata->>'expectedState' = u."accountState"::text
      AND (r.metadata->>'expectedUpdatedAt')::timestamp = u."updatedAt"
      AND r.metadata->'reviewed' = 'true'::jsonb
      AND length(btrim(r.metadata->>'reason')) > 0
      THEN r.metadata->>'accountState' END AS reviewed_state
  FROM "User" u
  LEFT JOIN LATERAL (
    SELECT metadata FROM "AuditLog"
    WHERE "targetType" = 'user' AND "targetId" = u.id::text
      AND (action = 'admin.user.update' OR "actionType" = 'admin.user.update')
      AND metadata->'before'->>'accountState' IS DISTINCT FROM metadata->'after'->>'accountState'
    ORDER BY "createdAt" DESC, id DESC LIMIT 1
  ) a ON true
  LEFT JOIN "AuditLog" r ON r."requestKey" = 'account-state-v1:' || u."identityUid"::text
    AND r.action = 'account-state.review.v1'
), classified AS (
  SELECT *, CASE
    WHEN before NOT IN ('ACTIVE','INACTIVE','PRE_REGISTERED','PENDING_PASSWORD') THEN NULL
    WHEN before = 'INACTIVE' THEN 'INACTIVE'
    WHEN before IN ('PRE_REGISTERED','PENDING_PASSWORD') AND role IN ('ADMIN','SUPERADMIN') THEN 'INACTIVE'
    WHEN before IN ('PRE_REGISTERED','PENDING_PASSWORD') AND admin_state IN ('INACTIVE','PRE_REGISTERED','PENDING_PASSWORD') THEN 'INACTIVE'
    WHEN reviewed_state IN ('ACTIVE','INACTIVE') THEN reviewed_state
    WHEN before = 'ACTIVE' AND (admin_state IS NULL OR admin_state = 'ACTIVE') THEN 'ACTIVE'
    WHEN before IN ('PRE_REGISTERED','PENDING_PASSWORD')
      AND (role IN ('ADMIN','SUPERADMIN') OR admin_state IN ('INACTIVE','PRE_REGISTERED','PENDING_PASSWORD')) THEN 'INACTIVE'
    ELSE NULL END AS after
  FROM evidence
)
SELECT *, CASE
  WHEN before NOT IN ('ACTIVE','INACTIVE','PRE_REGISTERED','PENDING_PASSWORD') THEN 'unknown_state'
  WHEN after IS NULL THEN 'review_required'
  WHEN reviewed_state IS NOT NULL THEN 'operator_review'
  WHEN before IN ('PRE_REGISTERED','PENDING_PASSWORD') THEN 'preserve_denied_access'
  ELSE 'unchanged' END AS reason
FROM classified;

-- ACCOUNT_STATE_APPLY: the audit command executes the preceding plan then ROLLBACK.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM account_state_plan WHERE after IS NULL) THEN
    RAISE EXCEPTION 'Account-state reconciliation requires review. Run audit-account-states.cjs; no data changed.';
  END IF;
  -- Preserve the previous public-registration eligibility independently of enablement.
  -- Never extend this capability to guest-order accounts or administrative roles.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
    AND table_name='User' AND column_name='registrationClaimable') THEN
    ALTER TABLE "User" ADD COLUMN "registrationClaimable" boolean NOT NULL DEFAULT false;
    UPDATE "User" SET "registrationClaimable"=true
    WHERE "accountState"::text='PRE_REGISTERED' AND role IN ('USER','FRIEND') AND "passwordHash" IS NULL;
  END IF;
  -- Rebuild the enum atomically. No deprecated value remains writable by old code.
  IF EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid
    WHERE t.typname='UserAccountState' AND e.enumlabel IN ('PRE_REGISTERED','PENDING_PASSWORD')) THEN
    ALTER TABLE "User" ALTER COLUMN "accountState" DROP DEFAULT;
    ALTER TYPE "UserAccountState" RENAME TO "UserAccountState_legacy";
    CREATE TYPE "UserAccountState" AS ENUM ('ACTIVE','INACTIVE');
    -- Use a temporary text column conversion; preserve timestamps and every other field.
    ALTER TABLE "User" ALTER COLUMN "accountState" TYPE text USING "accountState"::text;
    UPDATE "User" u SET "accountState"=p.after FROM account_state_plan p WHERE p.id=u.id AND p.before<>p.after;
    ALTER TABLE "User" ALTER COLUMN "accountState" TYPE "UserAccountState" USING "accountState"::"UserAccountState";
    ALTER TABLE "User" ALTER COLUMN "accountState" SET DEFAULT 'ACTIVE';
    DROP TYPE "UserAccountState_legacy";
  END IF;
END $$;
UPDATE "User" u SET "accountState"=p.after::"UserAccountState"
FROM account_state_plan p WHERE p.id=u.id AND u."accountState"::text<>p.after;
INSERT INTO "AuditLog" ("requestKey",action,"actionType","targetType","targetId",metadata)
SELECT 'account-state-migration-v1:' || "identityUid"::text,
  'account-state.reconcile.v1','account-state.reconcile.v1','user',id::text,
  jsonb_build_object('before',before,'after',after,'reason',reason,'identityUid',"identityUid")
FROM account_state_plan WHERE before<>after
ON CONFLICT ("requestKey") DO NOTHING;
COMMIT;
