import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDashboardController } from './admin-dashboard.controller';
import { PrismaService } from '../../prisma/prisma.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';

describe('lightweight sidebar request counts', () => {
  it('preserves counts without executing dashboard queries', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { fromCircle: 2, toCircle: 3, _count: { _all: 4 } },
      { fromCircle: 3, toCircle: 4, _count: { _all: 2 } },
    ]);
    const service = new AdminDashboardService({ circleUpgradeRequest: { groupBy } } as unknown as PrismaService);
    await expect(service.getPendingCounts()).resolves.toEqual({ requests: {
      pendingTotal: 6, byType: { '2-3': 4, '3-4': 2 },
    } });
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0][0].where).toEqual({ status: 'PENDING', OR: [
      { fromCircle: 2, toCircle: 3 }, { fromCircle: 3, toCircle: 4 },
    ] });
  });

  it('returns zeros when no pending requests exist and propagates failures', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const service = new AdminDashboardService({ circleUpgradeRequest: { groupBy } } as unknown as PrismaService);
    await expect(service.getPendingCounts()).resolves.toEqual({ requests: {
      pendingTotal: 0, byType: { '2-3': 0, '3-4': 0 },
    } });
    groupBy.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.getPendingCounts()).rejects.toThrow('database unavailable');
  });

  it('keeps authentication and admin authorization on the new endpoint', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminDashboardController)).toEqual([JwtAuthGuard, AdminGuard]);
  });
});
