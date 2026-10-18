import { MeService } from './me.service';
describe('customer logistics history ownership', () => {
  it('queries the exact authenticated owner and current tracking revision, returning no private audit or mail state', async () => {
    const db = { order: { findFirst: jest.fn(async () => ({ id: 42, trackingRevision: 3, trackingState: 'En reparto', trackingCategory: 'OUT_FOR_DELIVERY' })) },
      orderTrackingEvent: { findMany: jest.fn(async () => [{ label: '<literal>', eventTime: null, eventLocalDate: '18/10/2026 20:00:00', origin: 'CORREOS' }]) } };
    const service = new MeService(db as any, {} as any);
    const result = await service.getOrderTracking(9, 42);
    expect(db.order.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 42, userId: 9 } }));
    expect(db.orderTrackingEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { orderId: 42, revision: 3 } }));
    expect(result.events[0]).toEqual({ description: '<literal>', occurredAt: null, occurredLocalAt: '18/10/2026 20:00:00', source: 'Correos' });
    expect(result).not.toHaveProperty('notifications'); expect(result).not.toHaveProperty('audit');
  });
  it('does not read events for another account or an unknown order', async () => {
    const db = { order: { findFirst: jest.fn(async () => null) }, orderTrackingEvent: { findMany: jest.fn() } };
    await expect(new MeService(db as any, {} as any).getOrderTracking(7, 42)).rejects.toThrow('Pedido no encontrado');
    expect(db.orderTrackingEvent.findMany).not.toHaveBeenCalled();
  });
});
