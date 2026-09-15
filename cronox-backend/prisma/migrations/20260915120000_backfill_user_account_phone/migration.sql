-- One-time compatibility backfill for the Admin Users account phone.
-- If inconsistent data contains multiple default addresses, select the most
-- recently updated one and then the highest id as a stable tie-breaker. The
-- selected address must itself contain a non-empty phone; older defaults are
-- never used as a fallback.
WITH "rankedDefaultAddresses" AS (
  SELECT
    "userId",
    "phone",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "updatedAt" DESC, "id" DESC
    ) AS "defaultRank"
  FROM "Address"
  WHERE "isDefault" = TRUE
),
"selectedDefaultPhones" AS (
  SELECT "userId", "phone"
  FROM "rankedDefaultAddresses"
  WHERE
    "defaultRank" = 1
    AND "phone" IS NOT NULL
    AND BTRIM("phone") <> ''
)
UPDATE "User" AS "user"
SET "phone" = "selectedDefaultPhones"."phone"
FROM "selectedDefaultPhones"
WHERE
  "user"."id" = "selectedDefaultPhones"."userId"
  AND "user"."phone" IS NULL;
