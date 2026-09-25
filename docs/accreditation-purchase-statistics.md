# Accreditation purchase statistics

The accreditation figures are calculated from `Order` and `OrderItem` whenever
the profile stats endpoint is read. `historial` remains a compatibility cache;
completion, cancellation, refund, manual creation, and manual correction paths
rebuild it from the same records instead of incrementing counters.

## Counting rules

| Figure | Rule |
| --- | --- |
| Pedidos realizados | One per customer order in `PAID`, `PROCESSING`, `SHIPPED`, `DELIVERED`, `DISPUTED`, or `REFUNDED`. A full refund remains a genuine historical purchase. `PENDING` and `CANCELLED` do not count. |
| Artículos adquiridos | Sum of positive `OrderItem.quantity` for `PAID`, `PROCESSING`, `SHIPPED`, `DELIVERED`, and `DISPUTED` orders. A full refund removes every unit in that order. |
| Productos diferentes | Number of unique `OrderItem.productId` values among the same retained orders. Variants and sizes share the catalogue product ID, and repeat purchases count once. A refunded product still counts if another retained order contains it. |

The current data model records refunds at whole-order level. There is no
item-level partial-return record, so partial-return statistics are deliberately
not inferred from stock movements. A future partial-return feature must add an
authoritative returned-quantity record before changing these rules.

## In-person purchases

An administrator-entered sale is an `Order` with source `IN_PERSON_ADMIN`,
status `PAID`, provider `manual`, a non-Stripe payment method, the recording
administrator, and the actual purchase time. Prices are copied from the current
catalogue variant/product and VAT is reported as tax included, matching online
checkout. No shipping, tracking, Stripe object, or confirmation email is
created.

The form requires one explicit inventory choice:

- `DEDUCT_NOW` atomically checks and deducts stock and writes order-linked
  `manual_sale` movements.
- `ALREADY_ADJUSTED` does not touch stock; the immutable order field and audit
  log record that decision.

Submission is protected by a unique idempotency key and request hash. Replaying
the same request returns the original order; reusing its key for different data
is rejected.

## Corrections

Manual purchases are not edited in place. A superadministrator voids the entry
with a required reason, which changes it to `CANCELLED`, records who voided it
and when, and writes an audit event. Stock is restored exactly once only when
the original sale used `DEDUCT_NOW`. The corrected purchase can then be entered
as a new manual sale. Accreditation counters are never edited directly.
