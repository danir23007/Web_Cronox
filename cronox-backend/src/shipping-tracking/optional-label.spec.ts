import { OrderStatus } from '@prisma/client';
import { AdminOrdersService } from '../admin/orders/admin-orders.service';
import { TrackingService } from './tracking.service';
import { buildCorreosTrackingUrl } from './tracking-links';

describe('Correos tracking without an optional PDF label', () => {
  const environment = { ...process.env };
  afterEach(() => { process.env = { ...environment }; });

  it('saves the number, exposes its public link and synchronizes without a label', async () => {
    Object.assign(process.env, {
      CORREOS_TRACKING_ENABLED: 'true', CORREOS_EMAIL_ENABLED: 'false',
      EMAIL_ENABLED: 'false', BACKGROUND_JOBS_ENABLED: 'false',
    });
    delete process.env.CORREOS_LABEL_PRIVATE_DIR;
    const order: any = {
      id: 9, userId: null, user: null, customerEmail: 'buyer@example.test',
      status: OrderStatus.PAID, provider: 'stripe', providerRef: 'pi_inert_fixture',
      trackingNumber: null, trackingRevision: 0, shippingCarrier: 'Correos',
      trackingUrl: null, trackingBaselineEstablished: false, trackingFailures: 0,
      trackingLastSuccessAt: null, trackingLastErrorAt: null, trackingLeaseUntil: null,
      shippingLabel: null, trackingAudits: [], source: 'ONLINE', shippingMethodCode: 'STANDARD',
      shippedAt: null, deliveredAt: null, items: [],
      subtotal: { toFixed: () => '10.00' }, taxRate: { toFixed: () => '0.2100' },
      total: { toFixed: () => '12.95' }, taxAmount: { toFixed: () => '0.00' }, shippingCost: 295,
      currency: 'EUR', createdAt: new Date(), updatedAt: new Date(),
    };
    const db: any = {
      $queryRaw: jest.fn(async () => [{ id: 9 }]),
      $executeRaw: jest.fn(async () => 1),
      order: {
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => ({ ...order })),
        findUniqueOrThrow: jest.fn(async () => ({ ...order })),
        update: jest.fn(async ({ data }) => { Object.assign(order, data); return { ...order }; }),
      },
      orderTrackingAudit: { create: jest.fn(async () => ({})) },
      correosTrackingGate: { findUnique: jest.fn(async () => ({ notBefore: new Date(0) })) },
      orderTrackingNotification: { findMany: jest.fn(async () => []), updateMany: jest.fn(async () => ({ count: 0 })) },
      orderTrackingEvent: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => []),
      },
      orderShippingLabel: {
        create: jest.fn(() => { throw Error('PDF_MUST_BE_OPTIONAL'); }),
        upsert: jest.fn(() => { throw Error('PDF_MUST_BE_OPTIONAL'); }),
      },
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation((callback: (tx: any) => unknown) => callback(db));
    const email = { send: jest.fn() };
    const admin = new AdminOrdersService(db, {} as any, email as any, {} as any, {} as any);
    jest.spyOn(admin as any, 'syncHistorialForStatusChange').mockResolvedValue(undefined);
    jest.spyOn(admin as any, 'handlePromoUsageOnPaid').mockResolvedValue(undefined);
    const saved = await admin.updateOrderFulfillment(9, {
      trackingNumber: 'PQ123456789ES', trackingRevision: 0,
    });
    expect(saved.id).toBe(9);
    expect(saved.trackingNumber).toBe('PQ123456789ES');
    expect(saved.trackingUrl).toBe(buildCorreosTrackingUrl('PQ123456789ES'));

    const client = { search: jest.fn(async () => ({ code: 'PQ123456789ES', events: [] })) };
    const contract = { ready: true, parse: jest.fn(() => []) };
    const gate = { run: jest.fn((callback: () => Promise<unknown>) => callback()) };
    const tracking = new TrackingService(db, client as any, contract as any, gate as any);
    const synchronized = await tracking.syncOrder(9);

    expect(client.search).toHaveBeenCalledWith('PQ123456789ES');
    expect(synchronized).toMatchObject({ number: 'PQ123456789ES', publicUrl: saved.trackingUrl, label: null });
    expect(synchronized.lastSuccessAt).toBeInstanceOf(Date);
    expect(order.status).toBe(OrderStatus.PAID);
    expect(order.trackingBaselineEstablished).toBe(true);
    expect(order.shippingLabel).toBeNull();
    expect(db.orderShippingLabel.create).not.toHaveBeenCalled();
    expect(db.orderShippingLabel.upsert).not.toHaveBeenCalled();
    expect(email.send).not.toHaveBeenCalled();
  });
});
