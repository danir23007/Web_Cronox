# Production historical order cleanup — 2026-09-24

## Target and recovery

- Fixed cutoff: `2026-09-24T12:40:10.588Z`.
- Production release during cleanup: `cb64fcc21f1d3a5bea41511151dd18185809c12d`.
- Production database: Supabase project `frqlgocxnyppzdgxxjuq`, database `postgres`, through the Shared Session pooler on port 5432. Credentials are intentionally omitted.
- Fresh external backup: `C:\Users\danir\OneDrive\Documentos\CRONOX-database-backups\cronox-production-20260924-145528.dump`.
- Backup SHA-256: `82D7017205E7DBE084A900E4706A9C428FB30A0A2F0EEF2055B09B0A8759151C`.
- PostgreSQL 17 `pg_dump` and `pg_restore --list` both exited successfully. The custom dump has a `PGDMP` header, 902 catalog entries, includes the Supabase-managed and public schemas, and contains pre-cleanup `Order`, `OrderItem`, checkout, tombstone and Prisma migration table data.
- Restricted in-database recovery copy: `cronox_private.prelaunch_backup/2026-09-24T12:40:10.588Z` (18 orders, 3 linked snapshots, 25 stock movements).

## Controlled execution

The transaction acquired exclusive locks on the order, checkout, inventory-movement, promotion, history, activity, webhook-ledger and payment-tombstone tables. While the locks were held, PM2 restarted the root-owned production backend, terminating any in-flight worker. The transaction then inserted payment tombstones, performed the cleanup, verified inventory and movement invariants, and committed. The backend was restarted after completion and `/api/health` returned `{"ok":true}`.

No Stripe API was called. No Stripe payment/refund record was changed. The order sequence was not reset.

## Before and after

| Record | Before | After | Action |
|---|---:|---:|---|
| `Order` through cutoff | 18 (IDs 1–18) | 0 | Deleted |
| `OrderItem` | 23 | 0 | Deleted |
| Linked `CheckoutSnapshot` | 3 | 0 | Deleted; 61 unrelated snapshots preserved |
| Linked `CheckoutSnapshotItem` | 3 | 0 | Cascade deleted; 84 unrelated rows preserved |
| Linked `CheckoutStockReservation` | 3 | 0 | Cascade deleted; all were resolved; 84 unrelated rows preserved |
| `CustomerActivityEvent` linked to the cohort | 1 | 0 | Deleted |
| `PromoCodeRedemption` linked to the cohort | 1 | 0 | Deleted |
| Affected `PromoCode.usageCount` | 1 | 0 | Derived counter corrected; promo preserved |
| Affected `historial` aggregate | 16 orders / 25 items / 1 return | 0 / 0 / 0 | Reset; user preserved |
| `ArchivedCheckoutPayment` | 0 | 17 | Tombstones inserted |
| Matching processed `StripeWebhookEvent` rows | 7 | 7 | Preserved for audit/idempotency |
| `StockMovement` rows linked to the cohort | 25 | 25 | Preserved; foreign keys detached and reasons annotated with archived test source |
| `AuditLog` rows linked to the cohort | 0 | 0 | No change |

The 25 preserved stock movements comprise 22 sale deductions totalling −26 units, one refund of +1, and one reservation/release pair with net zero. Their immutable fields and total delta (−25) match the recovery copy. All 43 `ProductVariant` rows, including stock, timestamps and configuration, match the pre-cleanup snapshot; total stock remains 273.

The `Order_id_seq` remains at `last_value = 18`, `is_called = true`. No orders existed after the cutoff.

## Preservation and application verification

Counts before the dump and after cleanup remain equal for unrelated core data:

- Users: 36
- Products: 7
- Product variants: 43
- Shipping methods: 3
- Carts: 219
- Cart items: 29

Using existing valid server-side sessions without exposing credentials, the live endpoints returned:

- Customer `GET /api/orders`: HTTP 200, zero rows, total zero.
- SUPERADMIN `GET /api/admin/orders`: HTTP 200, zero rows, total zero.

The delayed-webhook guard is deployed: every signed Stripe webhook claims its event through `claimStripeWebhookEvent`, which rejects any payment intent in `ArchivedCheckoutPayment`. The 17 tombstones cover all distinct provider/payment references in the deleted cohort. Focused order, admin-order and webhook tests pass (75 tests), including successful-order creation and archived-payment retry behavior.

No live Stripe purchase was generated solely for verification. The production health endpoint is green, the order sequence is preserved for the next real order, and the existing order-creation test coverage passes.

## Accreditation deployment status

The mobile accreditation fix remains local and is not deployed. Production still serves `assets/profile.js?v=11`; the local change uses `v=12` and the real `.accreditation-book-art` image element.
