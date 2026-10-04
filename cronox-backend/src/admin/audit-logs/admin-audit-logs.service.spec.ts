import { AdminUsersService } from '../users/admin-users.service';
import { AdminAuditLogsService } from './admin-audit-logs.service';
import { auditLogRetentionCutoff } from './audit-log-retention';

describe('clear all Activity', () => {
  it('requires confirmation and shares concurrent deletion without filters', async () => {
    let finish!: (result: { count: number }) => void;
    const deleteMany = jest.fn(() => new Promise<{ count: number }>(resolve => { finish = resolve; }));
    const service = new AdminAuditLogsService({ auditLog: { deleteMany } } as any);
    expect(() => service.clear('')).toThrow('ACTIVITY_CONFIRMATION_REQUIRED');
    expect(deleteMany).not.toHaveBeenCalled();
    const first = service.clear('DELETE_ALL_ACTIVITY');
    const second = service.clear('DELETE_ALL_ACTIVITY');
    expect(second).toBe(first);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({});
    finish({ count: 12 });
    await expect(first).resolves.toEqual({ deleted: 12 });
  });

  it('propagates database failures and permits a deliberate retry', async () => {
    const deleteMany = jest.fn().mockRejectedValueOnce(new Error('local failure')).mockResolvedValueOnce({ count: 2 });
    const service = new AdminAuditLogsService({ auditLog: { deleteMany } } as any);
    await expect(service.clear('DELETE_ALL_ACTIVITY')).rejects.toThrow('local failure');
    await expect(service.clear('DELETE_ALL_ACTIVITY')).resolves.toEqual({ deleted: 2 });
    expect(deleteMany).toHaveBeenCalledTimes(2);
  });
});

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
