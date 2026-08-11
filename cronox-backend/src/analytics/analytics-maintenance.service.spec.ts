import {
  AnalyticsConsentStatus,
  CustomerActivityEventType,
} from '@prisma/client';
import { AnalyticsMaintenanceService } from './analytics-maintenance.service';

describe('AnalyticsMaintenanceService', () => {
  it('derives abandonment only from checkouts whose account still has active analytics consent', async () => {
    const prisma = {
      customerActivityEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      analyticsSession: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userLoginEvent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ count: 0 }, { count: 0 }, { count: 0 }]),
    };
    const service = new AnalyticsMaintenanceService(prisma as never);

    await (service as unknown as { run(): Promise<void> }).run();

    expect(prisma.customerActivityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eventType: CustomerActivityEventType.CHECKOUT_STARTED,
          user: { analyticsConsentStatus: AnalyticsConsentStatus.ACTIVE },
          checkoutSnapshot: expect.objectContaining({
            orderId: null,
            activityEvents: {
              none: {
                eventType: CustomerActivityEventType.CHECKOUT_ABANDONED,
              },
            },
          }),
        }),
      }),
    );
  });

  it('uses the centralized environment configuration for abandonment and both retention cutoffs', async () => {
    const original = {
      CHECKOUT_ABANDONMENT_MINUTES: process.env.CHECKOUT_ABANDONMENT_MINUTES,
      ANALYTICS_RETENTION_DAYS: process.env.ANALYTICS_RETENTION_DAYS,
      LOGIN_HISTORY_RETENTION_DAYS: process.env.LOGIN_HISTORY_RETENTION_DAYS,
    };
    process.env.CHECKOUT_ABANDONMENT_MINUTES = '61';
    process.env.ANALYTICS_RETENTION_DAYS = '181';
    process.env.LOGIN_HISTORY_RETENTION_DAYS = '366';
    const now = Date.UTC(2026, 7, 11, 12, 0, 0);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    const prisma = {
      customerActivityEvent: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      analyticsSession: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userLoginEvent: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest
        .fn()
        .mockResolvedValue([{ count: 0 }, { count: 0 }, { count: 0 }]),
    };

    try {
      const service = new AnalyticsMaintenanceService(prisma as never);
      await (service as unknown as { run(): Promise<void> }).run();

      expect(
        prisma.customerActivityEvent.findMany.mock.calls[0][0].where.createdAt
          .lt,
      ).toEqual(new Date(now - 61 * 60_000));
      expect(
        prisma.customerActivityEvent.deleteMany.mock.calls[0][0].where.createdAt
          .lt,
      ).toEqual(new Date(now - 181 * 86_400_000));
      expect(
        prisma.userLoginEvent.deleteMany.mock.calls[0][0].where.createdAt.lt,
      ).toEqual(new Date(now - 366 * 86_400_000));
    } finally {
      nowSpy.mockRestore();
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});
