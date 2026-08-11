import { AdminCustomerAnalyticsService } from './admin-customer-analytics.service';

describe('AdminCustomerAnalyticsService', () => {
  it('shows unavailable rather than fake zero behaviour metrics without consent or events', async () => {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 9,
          lastLoginAt: null,
          analyticsConsentStatus: null,
          analyticsConsentDecidedAt: null,
        }),
      },
      userLoginEvent: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      analyticsSession: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { activeSeconds: null } }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      customerActivityEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      orderItem: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: null } }),
      },
      $transaction: jest
        .fn()
        .mockImplementation((operations) => Promise.all(operations)),
    };
    const service = new AdminCustomerAnalyticsService(prisma);

    const result = await service.summary(9);

    expect(result.consent.status).toBe('NO_DECISION');
    expect(result.analytics).toEqual({
      available: false,
      reason: 'TRACKING_UNAVAILABLE',
    });
    expect(result.analytics).not.toHaveProperty('visits', 0);
  });

  it('paginates login history with bounded skip/take metadata', async () => {
    const prisma: any = {
      user: { count: jest.fn().mockResolvedValue(1) },
      userLoginEvent: {
        findMany: jest.fn().mockResolvedValue([{ id: 'login-21' }]),
        count: jest.fn().mockResolvedValue(41),
      },
      $transaction: jest
        .fn()
        .mockImplementation((operations) => Promise.all(operations)),
    };
    const service = new AdminCustomerAnalyticsService(prisma);

    const result = await service.logins(9, { page: 3, pageSize: 10 });

    expect(prisma.userLoginEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
    expect(result.meta).toEqual({
      page: 3,
      pageSize: 10,
      total: 41,
      totalPages: 5,
    });
  });
});
