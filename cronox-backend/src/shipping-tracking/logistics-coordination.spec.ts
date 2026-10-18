import { carrierNoticeCandidates, carrierProjection, logisticsNoticeDecision } from './fulfillment-policy';
import { TrackpubContract } from './trackpub.contract';
import { logisticsNoticeKey } from './fulfillment-events';
import { TrackingWorkerService } from './tracking-worker.service';
const contract = new TrackpubContract();
const cutoff = new Date('2026-10-18T19:00:00Z');
const event = (code: string, day = '18/10/2026', time = '20:00:00') => contract.parse({ events: [{ uniqueCode: code, eventDate: day, eventHours: time }] })[0];
const fresh = { status: 'PAID', trackingBaselineEstablished: false, trackingFlowStartedAt: new Date('2026-10-18T19:01:00Z') };
describe('coordinated manual/carrier notices and chronological projection', () => {
  it('allows the first same-day physical admission of a newly incorporated shipment, without a false UTC timestamp', () => {
    const admission = event('A010000V');
    expect(carrierNoticeCandidates(fresh, [admission], [], cutoff)).toMatchObject([{ category: 'SHIPPED', suppressionReason: null }]);
    expect(admission.eventTime).toBeNull();
  });
  it('holds old or ambiguous first histories without suppressing future newly incorporated shipments', () => {
    expect(logisticsNoticeDecision(event('A010000V', '14/10/2026'), cutoff, fresh)).toBe('HISTORICAL_EVENT');
    expect(logisticsNoticeDecision(event('A010000V'), cutoff, { trackingFlowStartedAt: null })).toBe('EVENT_TIMEZONE_AMBIGUOUS');
    expect(logisticsNoticeDecision({ ...event('A010000V'), eventSortKey: null }, cutoff, { trackingFlowStartedAt: null })).toBe('EVENT_DATE_MISSING');
  });
  it('uses a shared order-level identity for shipment and delivery across origins and tracking corrections', () => {
    expect(logisticsNoticeKey(42, 0, 'SHIPPED', 'manual')).toBe(logisticsNoticeKey(42, 2, 'SHIPPED', 'admission'));
    expect(logisticsNoticeKey(42, 0, 'DELIVERED', 'manual')).toBe(logisticsNoticeKey(42, 2, 'DELIVERED', 'carrier'));
    expect(logisticsNoticeKey(42, 1, 'OUT_FOR_DELIVERY', 'first')).not.toBe(logisticsNoticeKey(42, 2, 'OUT_FOR_DELIVERY', 'second'));
  });
  it('coalesces the same incident code while keeping distinct incidents and revisions separate', () => {
    expect(logisticsNoticeKey(42, 1, 'INCIDENT', 'one', 'O07A010R')).toBe(logisticsNoticeKey(42, 1, 'INCIDENT', 'two', 'O07A010R'));
    expect(logisticsNoticeKey(42, 1, 'INCIDENT', 'one', 'O07A010R')).not.toBe(logisticsNoticeKey(42, 1, 'INCIDENT', 'one', 'O200000R'));
  });
  it('does not avalanche intermediate historical milestones in an advanced first response', () => {
    const history = [event('A010000V'), event('H020000V', '19/10/2026'), event('I010000V', '20/10/2026')];
    expect(carrierNoticeCandidates(fresh, history, [], cutoff).map(c => c.category)).toEqual(['SHIPPED', 'DELIVERED']);
  });
  it('represents a later incidence/return after delivery and ignores late older admissions', () => {
    const history = [event('I010000V', '20/10/2026'), event('A010000V'), event('O07A010R', '21/10/2026')];
    expect(carrierProjection(history)?.category).toBe('INCIDENT');
    expect(carrierProjection([...history, event('I020000V', '22/10/2026')])?.category).toBe('RETURNED');
  });
  it('keeps unknown descriptions out of state interpretation', () => {
    expect(carrierProjection([event('UNKNOWN'), event('I010000V', '17/10/2026')])?.category).toBe('DELIVERED');
    expect(carrierNoticeCandidates(fresh, [event('UNKNOWN')], [], cutoff)).toEqual([]);
  });
  it('can drain manual logistics jobs through the existing worker without enabling Trackpub', async () => {
    const env = { ...process.env }; Object.assign(process.env, { CORREOS_TRACKING_ENABLED: 'false', CORREOS_EMAIL_ENABLED: 'false', ORDER_LOGISTICS_EMAIL_ENABLED: 'false', EMAIL_ENABLED: 'true', BACKGROUND_JOBS_ENABLED: 'true' });
    const tracking = { synchronizeDue: jest.fn() }, notifications = { tick: jest.fn() }, gate = { shared: jest.fn(async work => work()) };
    const worker = new TrackingWorkerService(tracking as any, notifications as any, gate as any);
    try { await worker.tick(); expect(notifications.tick).toHaveBeenCalledTimes(1); expect(tracking.synchronizeDue).not.toHaveBeenCalled(); }
    finally { await worker.onModuleDestroy(); process.env = env; }
  });
});
