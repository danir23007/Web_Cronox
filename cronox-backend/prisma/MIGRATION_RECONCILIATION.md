# Prisma migration reconciliation

The historical migration chain is not safe to replay onto a blank database.
For example, `20250203144300_auth_base` expects an existing `User` table,
while later migrations create a different `User` shape; `orders_fix_no_fk`
also conflicts with the current `Order.userId` relation. Do not edit, delete,
rename, or checksum-rewrite migrations that may already be recorded in
`_prisma_migrations`.

## Existing deployment database

1. Take a verified backup and restore it to an isolated staging database.
2. Record `prisma migrate status`, the contents of `_prisma_migrations`, and a
   schema diff before changing anything. Run the diff only against the staging
   URL, never a production URL from a developer workstation.
3. Confirm that the deployed database already matches the canonical Prisma
   schema except for the additive changes in
   `20260808010000_auth_security_hardening`.
4. Apply `prisma migrate deploy` first in staging, test auth/newsletter/reset
   flows, then run the same deploy through the production release process.
5. If the migration table is incomplete but the physical schema is known to be
   equivalent, have a DBA use `prisma migrate resolve --applied <name>` for
   each verified migration. Do not mark a migration applied merely to silence a
   deployment error.

## Role reconciliation before deployment

The hardening migration changes `NULL` roles to `USER` and enforces `NOT NULL`.
It deliberately does not elevate legacy `ADMIN` values. Before deployment,
have an authorized operator review the affected accounts on the staging copy:

```sql
SELECT "role", COUNT(*)
FROM "User"
GROUP BY "role"
ORDER BY "role";

SELECT "id", "email", "role"
FROM "User"
WHERE "role" IS NULL OR "role" IN ('ADMIN', 'SUPERADMIN')
ORDER BY "id";
```

Reassign each legacy `ADMIN` account to the least privileged current role that
matches its job. Reassign a legacy `SUPERADMIN` account to `SUPER_ADMIN` only
after confirming that it is an intended super-administrator. Record each
decision in the change ticket. `NULL` becomes `USER` automatically and never
receives administrative access.

## New databases

Do not run `prisma migrate deploy` directly against an empty database until a
DBA has created and tested a clean baseline from the canonical schema. Create
that baseline in a separate migration-repair change, validate it against a
fresh PostgreSQL instance, then mark only the equivalent historical migrations
as resolved. This avoids mutating already-applied production history while
giving new installations a replayable starting point.
