/* Run only AFTER the launch migration and backend deploy, with workers/webhooks
 * stopped for the brief apply window. Default is read-only. Never calls Stripe,
 * order cancellation, stock release or inventory services. */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
async function main() {
  if (!args.includes('--cutoff')) throw new Error('Required: --cutoff <ISO timestamp fixed BEFORE opening the store>');
  const cutoff = new Date(option('--cutoff'));
  if (!Number.isFinite(cutoff.getTime())) throw new Error('Invalid cutoff');
  const apply = args.includes('--apply');
  const orders = await db.order.findMany({ where: { createdAt: { lte: cutoff } }, select: { id: true } });
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', cutoff, orderCount: orders.length, orderIds: orders.map(o => o.id) }));
  if (!apply) return;
  if (!args.includes('--expected-orders') || Number(option('--expected-orders')) !== orders.length || !orders.length)
    throw new Error('Expected order count does not match. Review dry-run first.');
  if (!args.includes('--backend-stopped')) throw new Error('Stop backend/workers first; pass --backend-stopped only after doing so.');
  const ids = orders.map(o => o.id);
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "Order", "OrderItem", "CheckoutSnapshot", "CheckoutStockReservation", "StockMovement", "ProductVariant", "Cart", "CartItem", "historial", "PromoCode", "PromoCodeRedemption", "CustomerActivityEvent", "AuditLog" IN ACCESS EXCLUSIVE MODE');
    const current = await tx.order.findMany({ where: { createdAt: { lte: cutoff } }, select: { id: true } });
    if (JSON.stringify(current.map(o => o.id).sort()) !== JSON.stringify([...ids].sort())) throw new Error('Cohort changed');
    const snapshots = await tx.checkoutSnapshot.findMany({ where: { createdAt: { lte: cutoff } }, include: { items: true, stockReservations: true } });
    if (snapshots.some(s => s.stockReservations.some(r => r.status === 'RESERVED'))) throw new Error('Unresolved stock reservations: reconcile before cleanup; inventory will not be changed.');
    const snapshotIds = snapshots.map(s => s.id);
    if (snapshots.some(s => s.orderId && !ids.includes(s.orderId))) throw new Error('Snapshot belongs to a later order');
    const inventory = await tx.productVariant.findMany({ orderBy: { id: 'asc' } });
    const movements = await tx.stockMovement.findMany({ orderBy: { id: 'asc' } });
    const archive = {
      cutoff, orders: await tx.order.findMany({ where: { id: { in: ids } }, include: { items: true, promoCodeRedemptions: true } }),
      snapshots, movements,
      histories: await tx.historial.findMany(),
      activity: await tx.customerActivityEvent.findMany({ where: { OR: [{ orderId: { in: ids } }, { checkoutSnapshotId: { in: snapshotIds } }] } }),
      audit: await tx.auditLog.findMany({ where: { targetType: { equals: 'ORDER', mode: 'insensitive' }, targetId: { in: ids.map(String) } } }),
      inventory,
    };
    // Private transactional recovery copy; not served by the public Data API.
    await tx.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS cronox_private');
    await tx.$executeRawUnsafe('REVOKE ALL ON SCHEMA cronox_private FROM PUBLIC, anon, authenticated');
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS cronox_private.prelaunch_backup (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ DEFAULT now(), payload JSONB NOT NULL)');
    await tx.$executeRawUnsafe('REVOKE ALL ON cronox_private.prelaunch_backup FROM PUBLIC, anon, authenticated');
    await tx.$executeRawUnsafe('INSERT INTO cronox_private.prelaunch_backup(id,payload) VALUES ($1,$2::jsonb)', cutoff.toISOString(), JSON.stringify(archive));
    const refs = [...new Set([...archive.orders.map(o => o.providerRef), ...snapshots.map(s => s.stripePaymentIntentId)].filter(Boolean))];
    await tx.archivedCheckoutPayment.createMany({ data: refs.map(paymentIntentId => ({ paymentIntentId })), skipDuplicates: true });
    await tx.customerActivityEvent.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { checkoutSnapshotId: { in: snapshotIds } }] } });
    // Only detach foreign keys. Keep every inventory movement and stock value.
    await tx.stockMovement.updateMany({ where: { orderId: { in: ids } }, data: { orderId: null } });
    await tx.stockMovement.updateMany({ where: { checkoutSnapshotId: { in: snapshotIds } }, data: { checkoutSnapshotId: null } });
    await tx.checkoutSnapshot.deleteMany({ where: { id: { in: snapshotIds } } });
    await tx.promoCodeRedemption.deleteMany({ where: { orderId: { in: ids } } });
    await tx.auditLog.deleteMany({ where: { id: { in: archive.audit.map(a => a.id) } } });
    await tx.orderItem.deleteMany({ where: { orderId: { in: ids } } });
    await tx.order.deleteMany({ where: { id: { in: ids } } });
    // Only reset histories for affected users with no surviving real orders.
    const users = [...new Set(archive.orders.map(o => o.userId).filter(id => id != null))];
    for (const userId of users) {
      if (await tx.order.count({ where: { userId } })) throw new Error('Affected user has later orders; review history manually before cleanup.');
      await tx.historial.updateMany({ where: { userId }, data: { pedidosRealizados: 0, articulosAdquiridos: 0, devoluciones: 0 } });
    }
    const after = await tx.productVariant.findMany({ orderBy: { id: 'asc' } });
    if (JSON.stringify(inventory) !== JSON.stringify(after)) throw new Error('Inventory changed: rollback');
    const afterMovements = await tx.stockMovement.findMany({ orderBy: { id: 'asc' } });
    const withoutRefs = rows => rows.map(({ orderId, checkoutSnapshotId, ...row }) => row);
    if (JSON.stringify(withoutRefs(movements)) !== JSON.stringify(withoutRefs(afterMovements))) throw new Error('Inventory movements changed: rollback');
    console.log(JSON.stringify({ deletedOrders: ids.length, inventoryUnchanged: true, recoveryCopy: `cronox_private.prelaunch_backup/${cutoff.toISOString()}` }));
  }, { timeout: 60000 });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
