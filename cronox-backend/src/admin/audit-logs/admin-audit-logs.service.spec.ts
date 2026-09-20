import { AdminUsersService } from '../users/admin-users.service';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { auditLogRetentionCutoff } from './audit-log-retention';

describe('retained Admin AuditLog queries', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');
  let prisma: any;
  let service: AdminAuditLogsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
    prisma = {
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((operations) => Promise.all(operations)),
    };
    service = new AdminAuditLogsService(prisma);
  });

  afterEach(() => jest.useRealTimers());

  it('uses 100 server-side rows and guards the Activity list by cutoff', async () => {
    await service.list({ page: 2 });
    const query = prisma.auditLog.findMany.mock.calls[0][0];

    expect(query).toMatchObject({ skip: 100, take: 100 });
    expect(query.where.AND).toEqual(
      expect.arrayContaining([
        { createdAt: { gte: auditLogRetentionCutoff(now) } },
      ]),
    );
  });

  it('clamps an early dateFrom but preserves a more recent dateFrom', async () => {
    await service.list({ dateFrom: '2026-01-01T00:00:00.000Z' });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.AND).toContainEqual({
      createdAt: { gte: auditLogRetentionCutoff(now) },
    });

    prisma.auditLog.findMany.mockClear();
    await service.list({ dateFrom: '2026-09-15T00:00:00.000Z' });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.AND).toContainEqual({
      createdAt: { gte: new Date('2026-09-15T00:00:00.000Z') },
    });
  });

  it('guards both AuditLog user-history implementations', async () => {
    await service.listForUser(32);
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      createdAt: { gte: auditLogRetentionCutoff(now) },
    });

    prisma.auditLog.findMany.mockClear();
    const users = new AdminUsersService(prisma);
    await users.getUserAuditLogs(32);
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.AND[0]).toEqual({
      createdAt: { gte: auditLogRetentionCutoff(now) },
    });
  });
});
