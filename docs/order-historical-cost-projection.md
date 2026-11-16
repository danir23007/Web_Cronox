# Historical costs of orders with blank opening allocations

A managed product's opening inventory slice can have blank production, freight
and other costs while its original edition has a documented unit cost. Order
registration copied those blank allocations into the financial snapshot and
cleared the scalar cost. Unlike physical point sales, Finance and Map did not
resolve the edition evidence when reading orders.

Orders and point reconciliation now share `resolveHistoricalLotParts`.
Known frozen costs and complete linked receipts take precedence. Partial or
estimated receipts stay pending. A dated original-edition audit, or the existing
strict stable-edition policy, can resolve blank opening allocations. The active
product's current edition and ProductCost are never queried as substitutes.

Finance, Map and edition reports use a read-only order projection, including
documented cost reversals. The archives and physical allocations are unchanged;
no migration or historical data repair is required. New checkout and manual
order snapshots freeze the same verified evidence during registration. Edits
retain original units and use the original operation date for cost evidence.
Unknown costs still invalidate the affected total; warnings identify the order,
line, product, variant and original edition or missing snapshot/quantity.

Regression coverage lives in `order-historical-cost.spec.ts`, alongside the
existing point evidence, finance, map and PostgreSQL point integration tests.
It covers blank allocations with dated evidence, another active edition, later
cost changes, genuine unknowns, partial/estimated receipts, quantity mismatches,
frozen snapshots, repeated reads, registration and documented returns.

Production diagnosis and before/after simulations use read-only transactions.
Business amounts, operation IDs and private extracts remain in local evidence
and are excluded from the commit.
