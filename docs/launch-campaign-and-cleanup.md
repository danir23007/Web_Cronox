# CRONOX launch preparation

## What is ready

- Purchase fulfillment now removes purchased cart quantities even when a full refund was recorded before the success webhook. Existing successful-payment cleanup remains transactional and duplicate-safe. Unrelated cart items are retained. This does not prove the cause of a particular historical charge.
- `/admin-launch.html`: SUPERADMIN-only campaign preview and batch sending. Open the store first using the existing key-screen control. Each recipient gets a cryptographically random 15% code, bound to their authenticated user ID and original email, with a global use limit of one. Guest checkout cannot claim ownership by typing an email.
- `/launch.html`: one-use login token, hashed in the database, valid for 72 hours. A second click on the landing page protects against email link scanners consuming the token. The token stays in the URL fragment and is removed before requests. Standard session cookies are issued. This email grants access to the account and must not be forwarded. Admin accounts are excluded.
- SMTP claims persist after ambiguous failures to avoid automatic duplicate messages; review those recipients before resetting any claim. Sending never starts on deployment or preview.
- Cleanup script defaults to read-only and has no Stripe/refund/inventory-service calls. It keeps a private recovery copy, records payment tombstones, deletes the selected test orders and checkout records, removes their activity and redemptions, and resets purchase counters for affected accounts with no later orders. Existing promotional usage counters and member levels are not rewritten.

## Deployment order

1. Take a fresh full production backup. Review `prisma migrate status` against the intended database and apply the new migration using the normal production migration workflow. Do not reset the database or manually mark unrelated migrations as applied.
2. Deploy frontend and backend together. Merge to `main` triggers this repository's production deployment workflow. The production deployment/migration has NOT been performed by this change.
3. Verify the SUPERADMIN campaign preview and the login page. Only then perform cleanup with the backend and its workers stopped briefly, so old webhooks cannot race it. Stripe will retry requests after the service returns.
4. In the backend directory, with the usual production environment loaded, run the read-only cleanup preview:

   `node scripts/clean-prelaunch-orders.cjs --cutoff 2026-09-23T21:29:29.447Z`

   The read-only database inspection found order IDs 1–18 and zero active stock reservations at that cutoff. If the preview differs, investigate instead of changing the expected count to force execution.

5. After reviewing the preview, execute that exact cohort:

   `node scripts/clean-prelaunch-orders.cjs --cutoff 2026-09-23T21:29:29.447Z --expected-orders 18 --backend-stopped --apply`

   The flag is an operator assertion: actually stop the backend/workers first. The transaction locks relevant tables, refuses unresolved reservations and later orders on affected accounts, verifies every product variant is byte-for-byte unchanged and verifies every stock movement except detached order/checkout foreign keys. No stock quantity, size, product, price, movement delta or movement row is changed/deleted. Recovery data is stored in the restricted `cronox_private.prelaunch_backup` table; keep the external backup too. Stripe's own payment/refund history remains intact. Customer baskets are not globally wiped by cleanup.

6. Restart the backend; verify purchase histories are empty and inventory unchanged. Disable the key screen when ready. Open `/admin-launch.html`, review the exact message/count and press send. 32 eligible preregistrations were found during the read-only inspection; the preview reports the current count.

## Validation

Backend builds; 115 selected tests pass across orders, admin orders, authentication, campaign, login token and Stripe webhook behavior. The destructive cleanup script has NOT been run on production or integration-tested against a disposable PostgreSQL database. Live SMTP delivery and browser-to-production login have NOT been exercised. These remain deployment checks, not completed results.
