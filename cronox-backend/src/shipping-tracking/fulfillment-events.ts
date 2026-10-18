import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

export type LogisticsMilestone = 'SHIPPED' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'INCIDENT' | 'RETURNED';
export const logisticsMilestones: LogisticsMilestone[] = ['SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'INCIDENT', 'RETURNED'];
export function eligibleFulfillmentOrder(order: { status: string; source: string; shippingMethodCode: string | null }) {
  return ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status) && order.source !== 'IN_PERSON_ADMIN' &&
    !['LOCAL_PICKUP', 'PICKUP'].includes(order.shippingMethodCode || '');
}
export function logisticsMailEnabled(origin: string = 'CORREOS') {
  return process.env.EMAIL_ENABLED === 'true' &&
    (origin === 'MANUAL' || (process.env.ORDER_LOGISTICS_EMAIL_ENABLED ?? process.env.CORREOS_EMAIL_ENABLED) === 'true') &&
    process.env.BACKGROUND_JOBS_ENABLED !== 'false' && process.env.CRONOX_ROUTE_SMOKE_MODE !== 'true';
}
export function logisticsNoticeKey(orderId: number, revision: number, category: LogisticsMilestone, fingerprint: string, code?: string | null) {
  if (category === 'SHIPPED' || category === 'DELIVERED') return `ORDER:${orderId}:${category}`;
  return `ORDER:${orderId}:REV:${revision}:${category}${category === 'INCIDENT' ? ':' + (code || fingerprint) : ''}`;
}

/** Caller holds the Order row lock. State, event, audit and outbox share its commit. */
export async function recordLogisticsNotice(tx: Prisma.TransactionClient,
  order: { id: number; trackingRevision: number; status: string },
  category: LogisticsMilestone, event: { id: string; fingerprint: string; code?: string | null },
  options: { origin: 'MANUAL' | 'CORREOS'; previousStatus: string; nextStatus: string; suppressionReason?: string | null }) {
  return tx.orderTrackingNotification.createMany({ data: [{ orderId: order.id, revision: order.trackingRevision,
    eventId: event.id, category, noticeKey: logisticsNoticeKey(order.id, order.trackingRevision, category, event.fingerprint, event.code),
    origin: options.origin, transitionFrom: options.previousStatus, transitionTo: options.nextStatus,
    status: options.suppressionReason ? 'SUPPRESSED' : 'PENDING', suppressionReason: options.suppressionReason || null,
  }], skipDuplicates: true });
}

export async function recordManualFulfillment(tx: Prisma.TransactionClient,
  order: { id: number; status: string; trackingRevision: number; source: string; shippingMethodCode: string | null },
  previousStatus: string) {
  if (!eligibleFulfillmentOrder(order) || previousStatus === order.status || !['SHIPPED', 'DELIVERED'].includes(order.status)) return;
  const category = order.status as 'SHIPPED' | 'DELIVERED';
  const fingerprint = createHash('sha256').update(`MANUAL:${order.id}:${order.trackingRevision}:${category}`).digest('hex');
  const event = await tx.orderTrackingEvent.upsert({ where: { orderId_revision_fingerprint: { orderId: order.id, revision: order.trackingRevision, fingerprint } },
    create: { orderId: order.id, revision: order.trackingRevision, fingerprint, origin: 'MANUAL', category,
      code: `MANUAL_${category}`, label: category === 'SHIPPED' ? 'Enviado (confirmación manual)' : 'Entregado (confirmación manual)', eventTime: new Date() }, update: {} });
  await recordLogisticsNotice(tx, order, category, event, { origin: 'MANUAL', previousStatus, nextStatus: order.status });
}
