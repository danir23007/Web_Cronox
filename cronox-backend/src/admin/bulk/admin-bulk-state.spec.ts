import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserAccountState } from '@prisma/client';
import { createHash } from 'node:crypto';
import { AdminBulkService } from './admin-bulk.service';

describe('bulk user account state', () => {
  const updatedAt = new Date('2026-09-01T00:00:00.000Z');
  let rows: any[];
  let tx: any;
  let users: any;
  let service: AdminBulkService;
  const dto = (changes: Record<string, unknown>, ids = [2]) => ({
    kind: 'users' as const,
    ids,
    changes,
  });

  beforeEach(() => {
    rows = [
      {
        id: 2,
        name: 'Prueba',
        role: 'USER',
        circleLevel: 1,
        accountState: UserAccountState.PRE_REGISTERED,
        password: null,
        preRegistration: { userId: 2 },
        sessionVersion: 0,
        updatedAt,
      },
    ];
    tx = {
      user: {
        findUnique: jest.fn(async ({ where }) =>
          where.id === 1
            ? {
                id: 1,
                role: 'SUPERADMIN',
                accountState: 'ACTIVE',
                sessionVersion: 0,
              }
            : rows.find((r) => r.id === where.id),
        ),
        findMany: jest.fn(async ({ where }) =>
          rows.filter((r) => where.id.in.includes(r.id)),
        ),
      },
      category: { findMany: jest.fn().mockResolvedValue([]) },
      adminBulkOperation: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
      },
      auditLog: { create: jest.fn() },
      $executeRaw: jest.fn(),
    };
    users = {
      updateAdminUser: jest.fn(async (id, change) => {
        rows = rows.map((r) =>
          r.id === id ? { ...r, ...change, updatedAt: new Date() } : r,
        );
      }),
    };
    service = new AdminBulkService(
      { $transaction: (fn: any) => fn(tx) } as any,
      users,
      {} as any,
    );
    (service as any).jwt = {
      sign: jest.fn().mockReturnValue('review'),
      verify: jest.fn().mockImplementation(() => (service as any).token),
    };
  });

  async function apply(changes: Record<string, unknown>, ids = [2]) {
    const request = dto(changes, ids);
    const preview = await service.preview(request as any, 1);
    const normalized = (service as any).normalize(request);
    (service as any).token = {
      actor: 1,
      requestHash: createHash('sha256')
        .update(JSON.stringify(normalized))
        .digest('hex'),
      version: (await (service as any).plan(tx, request, 1)).version,
    };
    const result = await service.execute(
      {
        ...request,
        operationId: '00000000-0000-4000-8000-000000000002',
        reviewToken: preview.reviewToken,
      } as any,
      1,
    );
    return { preview, result };
  }

  it('changes only state and persists it when queried again', async () => {
    rows[0].accountState = UserAccountState.PENDING_PASSWORD;
    const { result } = await apply({
      accountState: UserAccountState.PRE_REGISTERED,
    });
    expect(result.counts).toEqual({ changed: 1, unchanged: 0, excluded: 0 });
    expect(users.updateAdminUser).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ accountState: 'PRE_REGISTERED' }),
      1,
      {},
      tx,
    );
    expect(
      (await service.preview(dto({}) as any, 1)).rows[0].before.accountState,
    ).toBe('PRE_REGISTERED');
  });

  it('combines state, role and circle in one update', async () => {
    const { preview } = await apply({
      accountState: 'PENDING_PASSWORD',
      role: 'FRIEND',
      circleLevel: 3,
    });
    expect(preview.rows[0].after).toMatchObject({
      accountState: 'PENDING_PASSWORD',
      role: 'FRIEND',
      circleLevel: 3,
    });
    expect(users.updateAdminUser).toHaveBeenCalledTimes(1);
  });

  it('leaves state untouched when omitted', async () => {
    await apply({ circleLevel: 4 });
    expect(users.updateAdminUser.mock.calls[0][1]).not.toHaveProperty(
      'accountState',
    );
    expect(rows[0].accountState).toBe('PRE_REGISTERED');
  });

  it('rejects an incompatible selection before writing any user', async () => {
    rows.push({ ...rows[0], id: 3, password: 'hash', accountState: 'ACTIVE' });
    await expect(
      service.preview(
        dto({ accountState: 'PRE_REGISTERED' }, [2, 3]) as any,
        1,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(users.updateAdminUser).not.toHaveBeenCalled();
  });

  it('requires a password for ACTIVE and a pre-registration for PRE_REGISTERED', async () => {
    await expect(
      service.preview(dto({ accountState: 'ACTIVE' }) as any, 1),
    ).rejects.toThrow('contraseña');
    rows[0].preRegistration = null;
    rows[0].accountState = 'PENDING_PASSWORD';
    await expect(
      service.preview(dto({ accountState: 'PRE_REGISTERED' }) as any, 1),
    ).rejects.toThrow('prerregistro existente');
  });

  it('checks the actor on the server and excludes SUPERADMIN accounts', async () => {
    tx.user.findUnique.mockResolvedValueOnce({
      id: 1,
      role: 'ADMIN',
      accountState: 'ACTIVE',
    });
    await expect(
      service.preview(dto({ accountState: 'PENDING_PASSWORD' }) as any, 1),
    ).rejects.toThrow(ForbiddenException);
    rows[0].role = 'SUPERADMIN';
    const result = await service.preview(
      dto({ accountState: 'PENDING_PASSWORD' }) as any,
      1,
    );
    expect(result.counts.excluded).toBe(1);
  });

  it('excludes the acting administrator from a state change', async () => {
    rows.push({
      ...rows[0],
      id: 1,
      role: 'SUPERADMIN',
      accountState: 'ACTIVE',
    });
    const result = await service.preview(
      dto({ accountState: 'PENDING_PASSWORD' }, [1, 2]) as any,
      1,
    );
    expect(result.counts).toEqual({ changed: 1, unchanged: 0, excluded: 1 });
  });

  it('rejects PENDING_PASSWORD when a password already exists', async () => {
    rows[0].password = 'hash';
    await expect(
      service.preview(dto({ accountState: 'PENDING_PASSWORD' }) as any, 1),
    ).rejects.toThrow('sin contraseña');
  });
});
