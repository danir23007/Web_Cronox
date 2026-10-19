import { Prisma, OrderStatus } from '@prisma/client';

/** All online fulfillment and welcome acceptance use the same owner lock. */
export async function lockWelcomeBenefit(tx: Prisma.TransactionClient, email: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'welcome-purchase:' + email.trim().toLowerCase()}))`;
}

/** Called in the authoritative order transaction, including purchases without a code. */
export async function recordWelcomePurchase(tx: Prisma.TransactionClient, order: {
  id: number; customerEmail: string; userId: number | null; source: string;
  status: OrderStatus; paidAt: Date | null;
}, checkoutId: string) {
  if (order.source !== 'ONLINE') return;
  const benefit = await tx.accountWelcomeBenefit.findFirst({ where: {
    OR: [{ email: order.customerEmail.trim().toLowerCase() }, ...(order.userId ? [{ userId: order.userId }] : [])],
  } });
  if (!benefit) return;
  if (benefit.originCheckoutId === checkoutId) {
    await tx.accountWelcomeBenefit.updateMany({ where: { id: benefit.id, originOrderId: null }, data: { originOrderId: order.id } });
    return;
  }
  if (benefit.sentAt && order.paidAt && order.paidAt >= benefit.sentAt &&
      ![OrderStatus.PENDING, OrderStatus.CANCELLED].includes(order.status as any)) {
    await tx.accountWelcomeBenefit.updateMany({ where: { id: benefit.id, firstOnlineOrderId: null }, data: { firstOnlineOrderId: order.id } });
  }
}
