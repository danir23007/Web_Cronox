import { AuditLogMaintenanceService } from './audit-log-maintenance.service';
import {
  auditLogRetentionCutoff,
  retainedAuditLogDateFilter,
} from './audit-log-retention';

describe('AuditLog 30-day retention', () => {
  const now = new Date('2026-09-20T12:00:00.000Z');

  it('retains entries through exactly 30 days and excludes older entries', () => {
    const cutoff = auditLogRetentionCutoff(now);
    const age = (milliseconds: number) =>
      new Date(now.getTime() - milliseconds);
    const day = 24 * 60 * 60 * 1000;

    expect(age(29 * day).getTime()).toBeGreaterThan(cutoff.getTime());
    expect(age(29 * day + 23 * 60 * 60 * 1000).getTime()).toBeGreaterThan(
      cutoff.getTime(),
    );
    expect(age(30 * day)).toEqual(cutoff);
    expect(age(31 * day).getTime()).toBeLessThan(cutoff.getTime());
    expect(retainedAuditLogDateFilter({}, now)).toEqual({ gte: cutoff });
  });

  it('never lets an earlier requested date bypass the cutoff', () => {
    const cutoff = auditLogRetentionCutoff(now);
    expect(
      retainedAuditLogDateFilter(
        { gte: new Date('2026-01-01T00:00:00.000Z') },
        now,
      ),
    ).toEqual({ gte: cutoff });
    expect(
      retainedAuditLogDateFilter(
        { gte: new Date('2026-09-15T00:00:00.000Z') },
        now,
      ),
    ).toEqual({ gte: new Date('2026-09-15T00:00:00.000Z') });
  });

  it('deletes only stale AuditLog rows and repeated zero-result runs are harmless', async () => {
    const prisma = {
      auditLog: {
        deleteMany: jest
          .fn()
          .mockResolvedValueOnce({ count: 3 })
          .mockResolvedValueOnce({ count: 0 }),
      },
      stockMovement: { deleteMany: jest.fn() },
      order: { deleteMany: jest.fn() },
    };
    const service = new AuditLogMaintenanceService(prisma as never);

    await expect(service.cleanup(now)).resolves.toBe(3);
    await expect(service.cleanup(now)).resolves.toBe(0);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: auditLogRetentionCutoff(now) } },
    });
    expect(prisma.stockMovement.deleteMany).not.toHaveBeenCalled();
    expect(prisma.order.deleteMany).not.toHaveBeenCalled();
  });

  it('prevents overlapping cleanup and absorbs database errors', async () => {
    let release!: (value: { count: number }) => void;
    const pending = new Promise<{ count: number }>((resolve) => {
      release = resolve;
    });
    const prisma = {
      auditLog: { deleteMany: jest.fn().mockReturnValue(pending) },
    };
    const service = new AuditLogMaintenanceService(prisma as never);
    const first = service.cleanup(now);

    await expect(service.cleanup(now)).resolves.toBe(0);
    release({ count: 0 });
    await expect(first).resolves.toBe(0);
    expect(prisma.auditLog.deleteMany).toHaveBeenCalledTimes(1);

    prisma.auditLog.deleteMany.mockRejectedValueOnce(new Error('offline'));
    await expect(service.cleanup(now)).resolves.toBe(0);
  });
});
