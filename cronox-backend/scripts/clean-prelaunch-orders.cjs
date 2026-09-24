/* Run only AFTER the launch migration, backend deploy and a verified external
 * backup. Default is read-only. Never calls Stripe, order cancellation, stock
 * release or inventory services. */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
const waitForBackendRestart = () => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Backend restart barrier timed out; transaction rolled back')), 45000);
  process.stdin.setEncoding('utf8');
  process.stdin.once('data', () => {
    clearTimeout(timer);
    process.stdin.pause();
    resolve();
  });
  console.log('EXCLUSIVE_LOCKS_ACQUIRED: restart the backend now, then press Enter to continue');
});
const archivedMovementReason = movement => {
  const source = movement.orderId != null
    ? `test_order=${movement.orderId}`
    : `test_checkout=${movement.checkoutSnapshotId}`;
  return `${movement.reason || 'inventory'} | archived_${source}`;
};
async function main() {
  if (!args.includes('--cutoff')) throw new Error('Required: --cutoff <ISO timestamp fixed BEFORE opening the store>');
  const cutoff = new Date(option('--cutoff'));
  if (!Number.isFinite(cutoff.getTime())) throw new Error('Invalid cutoff');
  const apply = args.includes('--apply');
  const orders = await db.order.findMany({
    where: { createdAt: { lte: cutoff } },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const ids = orders.map(o => o.id);
  const snapshotIds = (await db.checkoutSnapshot.findMany({
    where: { orderId: { in: ids } },
    orderBy: { id: 'asc' },
    select: { id: true },
  })).map(snapshot => snapshot.id);
  const counts = {
    orders: ids.length,
    orderItems: await db.orderItem.count({ where: { orderId: { in: ids } } }),
    linkedCheckoutSnapshots: snapshotIds.length,
    linkedSnapshotItems: await db.checkoutSnapshotItem.count({ where: { checkoutSnapshotId: { in: snapshotIds } } }),
    linkedStockReservations: await db.checkoutStockReservation.count({ where: { checkoutSnapshotId: { in: snapshotIds } } }),
    linkedStockMovements: await db.stockMovement.count({ where: { OR: [{ orderId: { in: ids } }, { checkoutSnapshotId: { in: snapshotIds } }] } }),
    promoCodeRedemptions: await db.promoCodeRedemption.count({ where: { orderId: { in: ids } } }),
    activityEvents: await db.customerActivityEvent.count({ where: { OR: [{ orderId: { in: ids } }, { checkoutSnapshotId: { in: snapshotIds } }] } }),
  };
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', cutoff, counts, orderIds: ids, linkedCheckoutSnapshotIds: snapshotIds }));
  if (!apply) return;
  if (!args.includes('--expected-orders') || Number(option('--expected-orders')) !== orders.length || !orders.length)
    throw new Error('Expected order count does not match. Review dry-run first.');
  const backendStopped = args.includes('--backend-stopped');
  const restartBarrier = args.includes('--restart-backend-under-lock');
  if (!backendStopped && !restartBarrier)
    throw new Error('Stop the backend or use --restart-backend-under-lock for a coordinated PM2 restart.');
  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('LOCK TABLE "Order", "OrderItem", "CheckoutSnapshot", "CheckoutSnapshotItem", "CheckoutStockReservation", "StockMovement", "ProductVariant", "Cart", "CartItem", "historial", "PromoCode", "PromoCodeRedemption", "CustomerActivityEvent", "AuditLog", "ArchivedCheckoutPayment", "StripeWebhookEvent" IN ACCESS EXCLUSIVE MODE');
    const current = await tx.order.findMany({ where: { createdAt: { lte: cutoff } }, orderBy: { id: 'asc' }, select: { id: true } });
    if (JSON.stringify(current.map(o => o.id).sort()) !== JSON.stringify([...ids].sort())) throw new Error('Cohort changed');
    // A timestamp alone is not ownership: abandoned checkouts can predate the
    // cutoff without belonging to an order. Only follow the explicit order FK.
    const snapshots = await tx.checkoutSnapshot.findMany({
      where: { orderId: { in: ids } },
      orderBy: { id: 'asc' },
      include: { items: true, stockReservations: true },
    });
    if (snapshots.some(s => s.stockReservations.some(r => r.status === 'RESERVED'))) throw new Error('Unresolved stock reservations: reconcile before cleanup; inventory will not be changed.');
    const transactionSnapshotIds = snapshots.map(s => s.id);
    if (JSON.stringify(transactionSnapshotIds) !== JSON.stringify(snapshotIds)) throw new Error('Linked checkout cohort changed');
    const inventory = await tx.productVariant.findMany({ orderBy: { id: 'asc' } });
    const movements = await tx.stockMovement.findMany({
      where: { OR: [{ orderId: { in: ids } }, { checkoutSnapshotId: { in: transactionSnapshotIds } }] },
      orderBy: { id: 'asc' },
    });
    if (restartBarrier) await waitForBackendRestart();
    const archive = {
      cutoff, orders: await tx.order.findMany({ where: { id: { in: ids } }, include: { items: true, promoCodeRedemptions: true } }),
      snapshots, movements,
      histories: await tx.historial.findMany(),
      activity: await tx.customerActivityEvent.findMany({ where: { OR: [{ orderId: { in: ids } }, { checkoutSnapshotId: { in: transactionSnapshotIds } }] } }),
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
    await tx.customerActivityEvent.deleteMany({ where: { OR: [{ orderId: { in: ids } }, { checkoutSnapshotId: { in: transactionSnapshotIds } }] } });
    // Keep every inventory movement and stock value. The source IDs remain in
    // the human-readable reason after the foreign keys are detached.
    for (const movement of movements) {
      await tx.stockMovement.update({
        where: { id: movement.id },
        data: {
          orderId: null,
          checkoutSnapshotId: null,
          reason: archivedMovementReason(movement),
        },
      });
    }
    await tx.checkoutSnapshot.deleteMany({ where: { id: { in: transactionSnapshotIds } } });
    const redemptions = archive.orders.flatMap(order => order.promoCodeRedemptions);
    const deletedRedemptionsByPromo = redemptions.reduce((counts, redemption) => {
      counts.set(redemption.promoCodeId, (counts.get(redemption.promoCodeId) || 0) + 1);
      return counts;
    }, new Map());
    await tx.promoCodeRedemption.deleteMany({ where: { orderId: { in: ids } } });
    for (const [promoCodeId, deletedCount] of deletedRedemptionsByPromo) {
      const promo = await tx.promoCode.findUnique({ where: { id: promoCodeId }, select: { usageCount: true } });
      if (!promo || promo.usageCount < deletedCount) throw new Error(`Promo ${promoCodeId} usage count is inconsistent`);
      await tx.promoCode.update({ where: { id: promoCodeId }, data: { usageCount: { decrement: deletedCount } } });
    }
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
    const afterMovements = await tx.stockMovement.findMany({
      where: { id: { in: movements.map(movement => movement.id) } },
      orderBy: { id: 'asc' },
    });
    const expectedMovements = movements.map(movement => ({
      ...movement,
      orderId: null,
      checkoutSnapshotId: null,
      reason: archivedMovementReason(movement),
    }));
    if (JSON.stringify(expectedMovements) !== JSON.stringify(afterMovements)) throw new Error('Inventory movement audit preservation failed: rollback');
    console.log(JSON.stringify({ deletedOrders: ids.length, inventoryUnchanged: true, recoveryCopy: `cronox_private.prelaunch_backup/${cutoff.toISOString()}` }));
  }, { timeout: 120000 });
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => db.$disconnect());
