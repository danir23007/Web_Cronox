import { OrderStatus } from '@prisma/client';
import { AdminOrdersService } from './admin-orders.service';
import { AdminOrdersController } from './admin-orders.controller';
import { SuperAdminGuard } from '../../common/guards/super-admin.guard';
import { buildCorreosTrackingUrl } from '../../shipping-tracking/tracking-links';

describe('Correos tracking assignment on the existing Order', () => {
  const fixture = (overrides = {}) => ({
    id: 9, userId: null, user: null, customerEmail: 'recipient@example.test',
    status: OrderStatus.PAID, provider: 'stripe', providerRef: 'pi_local_fixture',
    trackingNumber: 'OLD12345678', trackingRevision: 2, shippingCarrier: 'Correos',
    trackingUrl: buildCorreosTrackingUrl('OLD12345678'), trackingBaselineEstablished: true,
    trackingLeaseToken: 'old-query', trackingLeaseUntil: new Date(),
    trackingState: 'previous-state', trackingFailures: 3,
    shippedAt: null, deliveredAt: null, items: [],
    subtotal: { toFixed: () => '10.00' }, taxRate: { toFixed: () => '0.2100' },
    total: { toFixed: () => '12.95' }, taxAmount: { toFixed: () => '0.00' }, shippingCost: 295,
    currency: 'EUR', createdAt: new Date(), updatedAt: new Date(), ...overrides,
  });
  const setup = (overrides = {}) => {
    const order = fixture(overrides);
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 9 }]),
      $executeRaw: jest.fn().mockResolvedValue(1),
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockImplementation(({ data }) => ({ ...order, ...data })),
      },
      orderTrackingAudit: { create: jest.fn().mockResolvedValue({}) },
      user: { findUnique: jest.fn().mockResolvedValue({ identityUid: '9714ed2b-2137-4e2f-a853-3a628477e2c5' }) },
      orderTrackingNotification: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      $transaction: jest.fn(),
    };
    db.$transaction.mockImplementation(callback => callback(db));
    const email = { send: jest.fn() };
    const service = new AdminOrdersService(db as any, {} as any, email as any, {} as any, {} as any);
    jest.spyOn(service as any, 'syncHistorialForStatusChange').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'handlePromoUsageOnPaid').mockResolvedValue(undefined);
    return { db, order, service, email };
  };

  it('audits a correction, invalidates old work and preserves payment/stock and manual fulfillment', async () => {
    const { service, db, email } = setup();
    const detail = await service.updateOrderFulfillment(9, { trackingNumber: ' new12345678 ', trackingRevision: 2, replaceTracking: true }, 7);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
    expect(db.orderTrackingAudit.create).toHaveBeenCalledWith({ data: {
      orderId: 9, actorId: 7, actorIdentityUid: '9714ed2b-2137-4e2f-a853-3a628477e2c5',
      previousNumber: 'OLD12345678', nextNumber: 'NEW12345678', revision: 3,
    } });
    expect(db.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      trackingNumber: 'NEW12345678', trackingRevision: 3,
      trackingLeaseToken: null, trackingLeaseUntil: null,
      trackingBaselineEstablished: false, trackingState: null, trackingFailures: 0,
      trackingLastSuccessAt: null, trackingNextSyncAt: expect.any(Date),
      trackingUrl: buildCorreosTrackingUrl('NEW12345678'),
    }) }));
    expect(db.order.update.mock.calls[0][0].data).not.toHaveProperty('status');
    expect(db.order.update.mock.calls[0][0].data).not.toHaveProperty('shippedAt');
    expect(db.orderTrackingNotification.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ orderId: 9, revision: { lt: 3 } }),
      data: { status: 'CANCELLED', leaseToken: null, leaseUntil: null },
    }));
    expect(detail.id).toBe(9);
    expect(detail.status).toBe(OrderStatus.PAID);
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not reset history or queue work for an unchanged number', async () => {
    const { service, db } = setup();
    await service.updateOrderFulfillment(9, { trackingNumber: 'OLD12345678', trackingRevision: 2 }, 7);
    expect(db.orderTrackingAudit.create).not.toHaveBeenCalled();
    expect(db.orderTrackingNotification.updateMany).not.toHaveBeenCalled();
    expect(db.order.update.mock.calls[0][0].data).not.toHaveProperty('trackingRevision');
  });

  it('rejects a stale admin edit before creating audit or updating the order', async () => {
    const { service, db } = setup();
    await expect(service.updateOrderFulfillment(9, { trackingNumber: 'NEW12345678', trackingRevision: 1 }, 7))
      .rejects.toThrow('El seguimiento ha cambiado');
    expect(db.order.update).not.toHaveBeenCalled();
    expect(db.orderTrackingAudit.create).not.toHaveBeenCalled();
  });

  it('removes an assignment explicitly and stops its pending synchronizations', async () => {
    const { service, db } = setup();
    await service.updateOrderFulfillment(9, { trackingNumber: null, trackingRevision: 2, replaceTracking: true }, 7);
    expect(db.order.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
      trackingNumber: null, trackingUrl: null, trackingRevision: 3, trackingNextSyncAt: null,
    }));
  });

  it('canonicalizes an empty Correos carrier without overwriting it after number validation', async () => {
    const { service, db } = setup();
    await service.updateOrderFulfillment(9, { trackingNumber: 'new12345678', shippingCarrier: '', trackingRevision: 2, replaceTracking: true }, 7);
    expect(db.order.update.mock.calls[0][0].data).toEqual(expect.objectContaining({
      trackingNumber: 'NEW12345678', shippingCarrier: 'Correos', trackingRevision: 3,
    }));
  });

  it('validates the existing number when changing an unrelated carrier to Correos', async () => {
    const { service, db } = setup({ shippingCarrier: 'Other', trackingNumber: 'unvalidated reference' });
    await expect(service.updateOrderFulfillment(9, { shippingCarrier: 'Correos', trackingRevision: 2 }, 7))
      .rejects.toThrow('El seguimiento de Correos');
    expect(db.order.update).not.toHaveBeenCalled();
  });

  it.each(['USER', 'FRIEND', 'ADMIN'])('does not grant private label download to %s', role => {
    const guard = new SuperAdminGuard();
    const context = {
      getHandler: () => AdminOrdersController.prototype.downloadShippingLabel,
      getClass: () => AdminOrdersController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    } as any;
    expect(() => guard.canActivate(context)).toThrow();
  });
});
