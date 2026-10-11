'use strict';
// Read-only inspection. This command never updates costs, orders or archives.
const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { loadLocalEnvironment } = require('./start-local.cjs');
require('ts-node').register({ project: path.resolve(__dirname, '../tsconfig.json'), transpileOnly: true });
const { configuredManualCost } = require('../src/admin/finance/historical-cost');
const { cents, allocate } = require('../src/admin/finance/financial-calculations');

function reviewCost(order, line, operational, revisions, privateCost) {
  if (order.source !== 'IN_PERSON_ADMIN') throw Error('Configured-cost recovery is restricted to manual purchases');
  const base = { orderId: order.id, itemId: line.id, productId: line.productId, quantity: line.quantity,
    purchasedAt: order.purchasedAt, lineTotal: line.lineTotal, currency: order.currency };
  if (line.financialSnapshot?.unitCostCents != null) return { ...base, status: 'preserve', unitCostCents: line.financialSnapshot.unitCostCents, source: 'FinanceArchive.snapshot.items' };
  const evidence = [];
  if (operational?.unitCostCents != null) evidence.push({ unitCostCents: operational.unitCostCents, source: 'OrderItemFinancial', itemId: line.id });
  for (const revision of revisions) {
    const original = revision.snapshot?.items?.find(item => item.id === line.id && item.productId === line.productId);
    if (original?.financialSnapshot?.unitCostCents != null) evidence.push({ unitCostCents: original.financialSnapshot.unitCostCents, source: 'FinanceArchiveRevision', revision: revision.revision });
  }
  const historical = [...new Set(evidence.map(source => source.unitCostCents))];
  if (historical.length > 1) return { ...base, status: 'needs_evidence', reason: 'Conflicting saved historical costs', evidence };
  if (historical.length === 1) return { ...base, status: 'proposed', unitCostCents: historical[0], evidence };
  const value = configuredManualCost(privateCost);
  if (value !== null) return { ...base, status: 'proposed', unitCostCents: value, evidence: [{ source: 'ProductCost', productId: line.productId, unitCostCents: value, updatedAt: privateCost.updatedAt, rule: 'Configured cost authorized for manual purchases regardless of sale/update dates; freeze this value when applying recovery' }] };
  return { ...base, status: 'missing_cost', reason: privateCost?.unitCostCents == null ? 'No configured private cost' : 'Invalid configured private cost' };
}

function reviewLine(order, line, operational, revisions, privateCost) {
  const result = reviewCost(order, line, operational, revisions, privateCost);
  const lines = [...(order.items || [line])].sort((a, b) => a.id - b.id);
  const gross = lines.map(item => cents(item.lineTotal));
  const discounts = allocate(order.discountCents || 0, gross);
  const index = lines.findIndex(item => item.id === line.id);
  const revenueCents = gross[index] - discounts[index];
  const costCents = result.unitCostCents == null ? null : result.unitCostCents * line.quantity;
  return { ...result, productName: line.financialSnapshot?.productName || line.title,
    paidUnitCents: gross[index] / line.quantity, discountCents: discounts[index], revenueCents,
    costCents, profitCents: costCents == null ? null : revenueCents - costCents };
}

async function inspect(client, scope = 'local database only') {
  return client.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const archives = await tx.financeArchive.findMany({ orderBy: { orderId: 'asc' } });
    const manual = archives.filter(row => row.snapshot?.source === 'IN_PERSON_ADMIN');
    const orders = await tx.order.findMany({ where: { source: 'IN_PERSON_ADMIN' }, select: { id: true, items: { select: { id: true, financialSnapshot: true } } } });
    const costs = await tx.productCost.findMany();
    const revisions = await tx.financeArchiveRevision.findMany({ where: { orderId: { in: manual.map(row => row.orderId) } }, orderBy: { revision: 'asc' } });
    const rows = manual.flatMap(row => row.snapshot.items.map(line => ({ ...reviewLine(row.snapshot, line,
      orders.find(order => order.id === row.orderId)?.items.find(item => item.id === line.id)?.financialSnapshot,
      revisions.filter(revision => revision.orderId === row.orderId), costs.find(cost => cost.productId === line.productId)), expectedRevision: row.revision, orderStatus: row.snapshot.status })));
    return { inspectedAt: new Date().toISOString(), readOnly: true,
      manualOrders: manual.length, lines: rows.length, preserved: rows.filter(row => row.status === 'preserve').length,
      proposed: rows.filter(row => row.status === 'proposed').length, missingEvidence: rows.filter(row => row.status === 'needs_evidence').length,
      missingCosts: rows.filter(row => row.status === 'missing_cost').length,
      orderBreakdown: manual.map(archive => {
        const lines = rows.filter(row => row.orderId === archive.orderId);
        const revenueCents = lines.reduce((total, row) => total + row.revenueCents, 0);
        const costCents = lines.some(row => row.costCents == null) ? null : lines.reduce((total, row) => total + row.costCents, 0);
        return { orderId: archive.orderId, status: archive.snapshot.status, basis: 'Sale lines after discounts, shipping excluded; before any later refund/stock return', revenueCents, costCents, profitCents: costCents == null ? null : revenueCents - costCents };
      }),
      ordersWithoutArchive: orders.filter(order => !manual.some(row => row.orderId === order.id)).map(order => order.id), rows, scope };
  }, { isolationLevel: 'RepeatableRead', timeout: 60000 });
}

if (require.main === module) {
  const remote = process.argv[2] === '--source-env';
  const environment = remote ? require('dotenv').parse(fs.readFileSync(path.resolve(process.argv[3]))) : loadLocalEnvironment();
  if (remote) {
    const url = new URL(environment.DATABASE_URL);
    // Same configured source allowlist as the existing read-only snapshot exporter.
    if (url.hostname !== 'aws-1-eu-west-1.pooler.supabase.com' || url.pathname !== '/postgres') throw new Error('Unexpected source host');
  }
  const output = path.resolve(process.argv[remote ? 4 : 2] || path.resolve(__dirname, '../../test-results/manual-finance/review.json'));
  const client = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } });
  inspect(client, remote ? 'configured source, read-only' : 'local database only').then(report => {
    fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, manualOrders: report.manualOrders, lines: report.lines, preserved: report.preserved, proposed: report.proposed, missingEvidence: report.missingEvidence, missingCosts: report.missingCosts, ordersWithoutArchive: report.ordersWithoutArchive }));
  }).catch(error => { console.error(error.code || 'Manual finance inspection failed'); process.exitCode = 1; }).finally(() => client.$disconnect());
}
module.exports = { reviewLine, inspect };
