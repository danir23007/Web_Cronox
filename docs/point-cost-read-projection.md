# Historical point costs in every report

An old physical sale can contain a valid saved unit cost and its original edition,
while its inventory allocation has empty cost components. The immutable ledger
then contains a null cost. Previously, reports only corrected that null after an
explicit persisted reconciliation, even when sufficient historical evidence was
already available.

`applyPointCostRevisions` now shares the reconciliation evidence planner through
a read-only interface. Explicit revisions and known frozen costs take precedence.
Complete applicable receipt costs remain authoritative; partial or estimated
receipts and conflicting edition histories remain pending. Zero is an explicit
cost. The currently active edition never replaces the sale's original edition.

The point-list cards, individual reports, product/size breakdowns, chart buckets,
Finance with or without a point filter, and Map use this shared projection. The
Map aggregation also carries total and known cost alongside profit, including
the previously accumulated web costs when partial point metadata is merged. The
sale detail, correction and return flows reuse the original resolved units.
Legacy deltas without a line identifier are matched to their original snapshot.
Financial corrections that cannot be resolved together remain pending.

The projection performs no writes. Persisting a reconciliation is optional for
sales whose costs are already recoverable at read time. This release does not
run reconciliation or introduce a database migration. Existing public frontend
contracts and cache versions remain valid; rebuilding their artifacts produces
the same content.

## Verification

- `npm run typecheck --prefix cronox-backend`
- `npm run admin:typecheck`
- `npm test --prefix cronox-backend -- --runInBand --silent`
- `npm run admin:build`
- `npm run build:compiled --prefix cronox-backend`
- `node cronox-backend/scripts/test-sale-points-db.cjs`
- `git diff --check`

The disposable PostgreSQL regression compares all individual reports with the
general report on identical dates, point filters, list cards, Finance and Map.
It covers recovered history, explicit zero, genuine unknown costs, receipts,
reconciliation replay, and edits/returns before reconciliation. Real economic
extracts, identifiers, account fixtures and browser evidence remain in ignored
local output folders and are excluded from the publication.
