import { Decimal } from '@prisma/client/runtime/library';
import { MeService } from './me.service';

describe('MeService automatically-associated guest orders', () => {
  it('returns a completed guest order through the normal authenticated Mis pedidos query', async () => {
    const createdAt = new Date('2026-08-12T18:00:00.000Z');
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 301,
            createdAt,
            status: 'PAID',
            total: new Decimal('45.00'),
            currency: 'EUR',
            trackingNumber: null,
            trackingUrl: null,
            shippingCarrier: null,
            shippedAt: null,
            deliveredAt: null,
          },
        ]),
      },
    };
    const service = new MeService(prisma as any, {} as any);

    await expect(service.getOrders(72)).resolves.toEqual([
      expect.objectContaining({ id: 301, total: 45, currency: 'EUR' }),
    ]);
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 72 } }),
    );
  });
});
