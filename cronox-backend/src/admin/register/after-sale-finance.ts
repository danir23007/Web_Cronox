import { Prisma } from '@prisma/client';
import { FinanceEvent, FinanceOrder } from '../finance/financial-calculations';
import { PointDelta } from '../points/point-calculations';

// Read projections only. Signed provider events keep their original stored amounts.
export async function attachAfterSales(
  tx: Prisma.TransactionClient,
  orders: FinanceOrder[],
  events: FinanceEvent[],
) {
  const operations = await tx.afterSaleOperation.findMany({
    where: { orderId: { in: orders.map((o) => o.id) } },
    orderBy: { occurredAt: 'asc' },
  });
  if (!operations.length) return { orders, events };
  const signed = events.length
    ? await tx.stripeWebhookEvent.findMany({
        where: { id: { in: events.map((e) => e.id) } },
        select: { id: true, payload: true },
      })
    : [];
  const normalized = events.map((event) => {
    const payload = signed.find((e) => e.id === event.id)?.payload as any;
    const refunds = payload?.data?.object?.refunds?.data;
    const matched = Array.isArray(refunds)
      ? operations
          .filter(
            (op) =>
              op.kind === 'RETURN' &&
              op.externalReference &&
              orders.some(
                (o) =>
                  o.id === op.orderId &&
                  o.providerRef === event.paymentIntentId,
              ) &&
              refunds.some(
                (r: any) =>
                  r.id === op.externalReference &&
                  r.status === 'succeeded' &&
                  r.amount === op.refundCents,
              ),
          )
          .reduce((n, op) => n + op.refundCents, 0)
      : 0;
    const priorManual = operations.some(
      (op) =>
        op.kind === 'RETURN' &&
        orders.some(
          (o) => o.id === op.orderId && o.providerRef === event.paymentIntentId,
        ),
    );
    const ambiguous =
      event.type === 'charge.refunded' &&
      priorManual &&
      (event.refundCumulativeCents == null ||
        matched !== event.refundCumulativeCents);
    return {
      ...event,
      matchedManualCents: matched,
      ambiguousAfterSaleRefund: ambiguous,
    };
  });
  return {
    orders: orders.map((o) => ({
      ...o,
      afterSales: operations
        .filter((op) => op.orderId === o.id)
        .map((op) => ({
          occurredAt: op.occurredAt,
          refundCents: op.refundCents,
          lines: op.lines as unknown as PointDelta[],
        })),
    })),
    events: normalized,
  };
}
