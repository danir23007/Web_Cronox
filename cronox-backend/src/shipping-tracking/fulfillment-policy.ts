import { TrackingEvent } from './trackpub.contract';

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
