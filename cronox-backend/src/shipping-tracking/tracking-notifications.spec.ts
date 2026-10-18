import { TrackingNotificationsService } from './tracking-notifications.service';
import { TrackingWorkerService } from './tracking-worker.service';
import { eligibleTrackingOrder } from './tracking.service';

describe('persistent carrier notification outbox (simulated SMTP)', () => {
  const original = { ...process.env };
  beforeEach(() => Object.assign(process.env, { EMAIL_ENABLED: 'true', CORREOS_EMAIL_ENABLED: 'true', BACKGROUND_JOBS_ENABLED: 'true' }));
  afterEach(() => { process.env = { ...original }; });
  function fixture() {
    const job: any = { id: 'notice', orderId: 42, revision: 3, eventId: 'event', category: 'SHIPPED', status: 'PENDING', attempts: 0, nextAttemptAt: new Date(0) };
    const order: any = { id: 42, trackingRevision: 3, trackingNumber: 'PQ123456789ES', shippingCarrier: 'Correos', status: 'SHIPPED', source: 'ONLINE', shippingMethodCode: 'STANDARD', customerEmail: 'buyer@example.test' };
    const update = jest.fn(async ({ data }) => { Object.assign(job, data); return job; });
    const updateMany = jest.fn(async ({ where, data }) => {
      if (where.id && where.id !== job.id || where.leaseToken && job.leaseToken !== where.leaseToken ||
        where.status && (typeof where.status === 'string' ? where.status !== job.status : !where.status.in.includes(job.status)) ||
        where.leaseUntil && (!job.leaseUntil || job.leaseUntil > where.leaseUntil.lte)) return { count: 0 };
      Object.assign(job, data, data.attempts ? { attempts: job.attempts + 1 } : {}); return { count: 1 };
    });
    const tx = { $queryRaw: jest.fn(async () => [{ id: 42 }]), order: { findUniqueOrThrow: jest.fn(async () => order) },
      orderTrackingNotification: { findUniqueOrThrow: jest.fn(async () => ({ ...job })), update },
      orderTrackingEvent: { findUniqueOrThrow: jest.fn(async () => ({ label: 'Entregado al destinatario', code: 'I010000V' })) } };
    const db = { $transaction: jest.fn(async callback => callback(tx)), orderTrackingNotification: { updateMany,
      findMany: jest.fn(async () => ['PENDING', 'RETRY'].includes(job.status) ? [job] : []) } };
    const email = { send: jest.fn(async () => ({ messageId: 'smtp-fixture' })) };
    return { service: new TrackingNotificationsService(db as any, email as any), db, tx, email, job, order };
  }
  it('claims once, uses orders template/data and never sends a duplicate on replay', async () => {
    const { service, email, job } = fixture();
    await Promise.all([service.deliver('notice'), service.deliver('notice')]);
    await service.deliver('notice');
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0]).toEqual([expect.objectContaining({ type: 'ORDER_TRACKING', to: 'buyer@example.test',
      templateData: expect.objectContaining({ orderId: '42', trackingNumber: 'PQ123456789ES', trackingUrl: expect.stringContaining('tracking-number=PQ123456789ES') }) })]);
    expect(job.status).toBe('SENT'); expect(job.messageId).toBe('smtp-fixture');
  });
  it('cancels an old revision before SMTP starts', async () => {
    const { service, email, job, order } = fixture(); order.trackingRevision++;
    await service.deliver('notice'); expect(job.status).toBe('CANCELLED'); expect(email.send).not.toHaveBeenCalled();
  });
  it.each(['CANCELLED', 'REFUNDED', 'PENDING', 'DISPUTED'])('does not mail an ineligible payment/order state %s', async status => {
    const { service, email, job, order } = fixture(); order.status = status;
    await service.deliver('notice'); expect(job.status).toBe('CANCELLED'); expect(email.send).not.toHaveBeenCalled();
  });
  it('recovers an interrupted SMTP attempt as UNKNOWN without resending', async () => {
    const { service, email, job } = fixture(); Object.assign(job, { status: 'SENDING', leaseUntil: new Date(0), leaseToken: 'old-process' });
    await service.tick(); expect(job.status).toBe('UNKNOWN'); expect(email.send).not.toHaveBeenCalled();
  });
  it('preserves ambiguous SMTP outcomes for manual reconciliation', async () => {
    const { service, email, job } = fixture(); email.send.mockRejectedValue(Object.assign(Error('fixture'), { deliveryUnknown: true }) as never);
    await service.deliver('notice'); expect(job.status).toBe('UNKNOWN');
    await service.tick(); expect(email.send).toHaveBeenCalledTimes(1);
  });
  it('does not resend if recording SMTP acceptance fails', async () => {
    const { service, email, job, tx } = fixture(); tx.orderTrackingNotification.update.mockRejectedValue(Error('transaction failed') as never);
    await service.deliver('notice'); expect(job.status).toBe('UNKNOWN');
    await service.tick(); expect(email.send).toHaveBeenCalledTimes(1);
  });
  it('requires explicit mail opt-in even if normal email is enabled', async () => {
    const { service, email, db } = fixture(); process.env.CORREOS_EMAIL_ENABLED = 'false';
    await service.tick(); await service.deliver('notice'); expect(email.send).not.toHaveBeenCalled(); expect(db.$transaction).not.toHaveBeenCalled();
  });
  it('retries a proven transport rejection and marks SENT only after acceptance', async () => {
    const { service, email, job } = fixture();
    email.send.mockRejectedValueOnce(Object.assign(Error('rejected'), { getStatus: () => 500 }) as never);
    await service.deliver('notice'); expect(job.status).toBe('RETRY'); expect(job.messageId).toBeUndefined();
    job.nextAttemptAt = new Date(0);
    await service.deliver('notice'); expect(job.status).toBe('SENT'); expect(email.send).toHaveBeenCalledTimes(2);
  });
  it.each(['ADMITTED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'INCIDENT'])('cancels legacy %s notices before SMTP', async category => {
    const { service, email, job } = fixture(); job.category = category;
    await service.deliver('notice'); expect(job.status).toBe('CANCELLED'); expect(email.send).not.toHaveBeenCalled();
  });
  it('excludes in-person purchases and local collection without guessing from shipping price', () => {
    const { order } = fixture(); expect(eligibleTrackingOrder(order)).toBe(true);
    expect(eligibleTrackingOrder({ ...order, source: 'IN_PERSON_ADMIN' })).toBe(false);
    expect(eligibleTrackingOrder({ ...order, shippingMethodCode: 'PICKUP' })).toBe(false);
  });
  it('keeps the periodic worker inert when disabled', async () => {
    process.env.CORREOS_TRACKING_ENABLED = 'false';
    const tracking = { synchronizeDue: jest.fn() }, notifications = { tick: jest.fn() }, gate = { shared: jest.fn() };
    const worker = new TrackingWorkerService(tracking as any, notifications as any, gate as any);
    worker.onModuleInit(); await worker.tick(); await worker.onModuleDestroy();
    expect(tracking.synchronizeDue).not.toHaveBeenCalled(); expect(gate.shared).not.toHaveBeenCalled();
  });
});
