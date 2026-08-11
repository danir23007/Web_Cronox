import { CustomerActivityEventType } from '@prisma/client';
import { OrdersService } from '../orders/orders.service';
import { AnalyticsMaintenanceService } from './analytics-maintenance.service';

describe('analytics checkout lifecycle', () => {
  it('marks a stale server checkout as abandoned once', async () => {
    const prisma: any = {
      customerActivityEvent: {
        findMany: jest.fn().mockResolvedValue([{
          userId: 4,
          sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
          checkoutSnapshotId: 'checkout_1',
        }]),
        create: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      analyticsSession: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userLoginEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      $transaction: jest.fn().mockImplementation((operations) => Promise.all(operations)),
    };
    const maintenance = new AnalyticsMaintenanceService(prisma);

    await (maintenance as any).run();

    expect(prisma.customerActivityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: CustomerActivityEventType.CHECKOUT_ABANDONED,
        checkoutSnapshotId: 'checkout_1',
      }),
    });
  });

  it('removes abandonment and idempotently records a late completion from the order', async () => {
    const tx = {
      customerActivityEvent: {
        findUnique: jest.fn().mockResolvedValue({
          userId: 4,
          sessionId: 'b15f2427-72ea-49f9-9e4d-e3138fcb5798',
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma: any = {
      $transaction: jest.fn().mockImplementation((callback) => callback(tx)),
    };
    const orders = new OrdersService(prisma, {} as any, {} as any, {} as any, {} as any);

    await (orders as any).recordCompletedCheckoutAnalytics('checkout_1', 88);

    expect(tx.customerActivityEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        eventType: CustomerActivityEventType.CHECKOUT_ABANDONED,
        checkoutSnapshotId: 'checkout_1',
      },
    });
    expect(tx.customerActivityEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          eventType: CustomerActivityEventType.CHECKOUT_COMPLETED,
          orderId: 88,
        }),
      }),
    );
  });
});
