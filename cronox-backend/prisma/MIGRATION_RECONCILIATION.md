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

The canonical roles are `USER`, `FRIEND`, `ADMIN`, and `SUPERADMIN`. The pending
canonical-role migration preserves `USER` as the default and converts the former
underscored Super Admin spelling to `SUPERADMIN` before replacing the PostgreSQL
enum. Before deployment, have an authorized operator review role counts on the
staging copy:

```sql
SELECT "role", COUNT(*)
FROM "User"
GROUP BY "role"
ORDER BY "role";

SELECT "role", COUNT(*)
FROM "User"
WHERE "role"::text NOT IN ('USER', 'FRIEND', 'ADMIN', 'SUPERADMIN')
GROUP BY "role"
ORDER BY "role";
```

The migration intentionally aborts before changing data if any unsupported role
other than the former Super Admin spelling is assigned. Resolve such records in
an approved change before retrying deployment; do not silently reclassify them.

## Account phone migration order

`20260915110000_add_user_account_phone` follows
`20260915100000_canonical_user_roles`. It only adds the nullable `User.phone`
column used as the account/administrative contact phone.

`20260915120000_backfill_user_account_phone` then performs a one-time copy for
users whose account phone is still null. It selects only an address marked as
default and copies its non-empty phone without changing the address. If corrupt
historical data has multiple defaults, it deterministically selects the newest
`updatedAt`, breaking ties with the highest address `id`; it never falls back to
an older default whose phone happens to be populated. Deploy all three through
one ordered `prisma migrate deploy` run after the role preflight succeeds.

## New databases

Do not run `prisma migrate deploy` directly against an empty database until a
DBA has created and tested a clean baseline from the canonical schema. Create
that baseline in a separate migration-repair change, validate it against a
fresh PostgreSQL instance, then mark only the equivalent historical migrations
as resolved. This avoids mutating already-applied production history while
giving new installations a replayable starting point.
