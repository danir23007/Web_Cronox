import { TrackingEvent } from './trackpub.contract';
import { LogisticsMilestone } from './fulfillment-events';

export const physicalCategories = ['ADMITTED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'];

/** No timezone is specified by Trackpub. Keep the local date, never append Z.
 * For notification eligibility use the entire possible UTC offset range (±14h).
 * Only dates unambiguously after cutover are eligible without a verified zone. */
export function shippedNoticeDecision(admission: TrackingEvent | undefined, cutoff: Date | null,
  order?: { createdAt: Date; trackingAttachedAt: Date | null }): string | null {
  if (!cutoff) return 'CUTOFF_NOT_ESTABLISHED';
  if (!admission) return 'ADMISSION_DATE_MISSING';
  const newOrder = Boolean(order && order.createdAt >= cutoff && order.trackingAttachedAt && order.trackingAttachedAt >= cutoff);
  if (admission.eventTime) return admission.eventTime >= cutoff ? null : 'HISTORICAL_ADMISSION';
  if (!admission.eventSortKey) return newOrder ? null : 'ADMISSION_DATE_MISSING';
  const wallTime = Date.parse(admission.eventSortKey + 'Z');
  if (!Number.isFinite(wallTime)) return 'ADMISSION_DATE_MISSING';
  if (wallTime - 14 * 3600000 >= cutoff.getTime()) return null;
  if (wallTime + 14 * 3600000 < cutoff.getTime()) return 'HISTORICAL_ADMISSION';
  if (newOrder) return null;
  return 'ADMISSION_TIMEZONE_AMBIGUOUS';
}

export function fulfillmentEvidence(events: TrackingEvent[]) {
  const dated = events.filter(e => e.eventTime || e.eventSortKey).sort((a, b) =>
    (a.eventSortKey || a.eventTime?.toISOString() || '').localeCompare(b.eventSortKey || b.eventTime?.toISOString() || ''));
  return {
    physical: events.some(e => physicalCategories.includes(e.category || '')),
    admission: dated.find(e => e.category === 'ADMITTED') || events.find(e => e.category === 'ADMITTED'),
    delivered: events.some(e => e.category === 'DELIVERED'),
    delivery: dated.find(e => e.category === 'DELIVERED'),
  };
}

export function logisticsNoticeDecision(event: TrackingEvent, cutoff: Date | null,
  order: { trackingFlowStartedAt: Date | null }): string | null {
  if (!cutoff) return 'CUTOFF_NOT_ESTABLISHED';
  const freshFlow = Boolean(order.trackingFlowStartedAt && order.trackingFlowStartedAt >= cutoff);
  if (event.eventTime) return event.eventTime >= cutoff ? null : 'HISTORICAL_EVENT';
  if (!event.eventSortKey) return freshFlow ? null : 'EVENT_DATE_MISSING';
  const wall = Date.parse(event.eventSortKey + 'Z');
  if (wall + 14 * 3600000 < cutoff.getTime()) return 'HISTORICAL_EVENT';
  if (wall - 14 * 3600000 >= cutoff.getTime() || freshFlow) return null;
  return 'EVENT_TIMEZONE_AMBIGUOUS';
}

export function carrierProjection<T extends TrackingEvent>(history: T[]) {
  const priority: Record<string, number> = { ADMITTED: 1, IN_TRANSIT: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4, INCIDENT: 5, RETURNED: 6 };
  return history.filter(e => e.category).sort((a, b) =>
    (b.eventSortKey || '').localeCompare(a.eventSortKey || '') ||
    (priority[b.category!] || 0) - (priority[a.category!] || 0) || a.fingerprint.localeCompare(b.fingerprint))[0];
}

export function carrierNoticeCandidates<T extends TrackingEvent>(order: { status: string; trackingBaselineEstablished: boolean; trackingFlowStartedAt: Date | null },
  history: T[], previous: T[], cutoff: Date | null) {
  const evidence = fulfillmentEvidence(history);
  const candidates: { category: LogisticsMilestone; event: T; suppressionReason: string | null }[] = [];
  const shipping = history.find(e => e.fingerprint === evidence.admission?.fingerprint) || history.find(e => physicalCategories.includes(e.category || ''));
  if (shipping) candidates.push({ category: 'SHIPPED', event: shipping, suppressionReason:
    ['SHIPPED', 'DELIVERED'].includes(order.status) ? 'PREEXISTING_SHIPPED_STATUS' : logisticsNoticeDecision(shipping, cutoff, order) });
  const delivered = history.find(e => e.category === 'DELIVERED');
  if (delivered) candidates.push({ category: 'DELIVERED', event: delivered, suppressionReason:
    order.status === 'DELIVERED' ? 'PREEXISTING_DELIVERED_STATUS' : logisticsNoticeDecision(delivered, cutoff, order) });
  const latest = carrierProjection(history);
  const previousLatest = previous.map(e => e.eventSortKey).filter(Boolean).sort().at(-1);
  if (latest && ['OUT_FOR_DELIVERY', 'INCIDENT', 'RETURNED'].includes(latest.category || '') &&
      !previous.some(e => e.fingerprint === latest.fingerprint)) {
    const behind = previousLatest && (!latest.eventSortKey || latest.eventSortKey < previousLatest);
    candidates.push({ category: latest.category as LogisticsMilestone, event: latest,
      suppressionReason: behind ? 'OUT_OF_ORDER_EVENT' : logisticsNoticeDecision(latest, cutoff, order) });
  }
  return candidates;
}
