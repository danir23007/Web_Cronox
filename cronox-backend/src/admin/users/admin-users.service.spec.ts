/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Role, UserAccountState } from '@prisma/client';
import { AdminUsersService } from './admin-users.service';

describe('AdminUsersService protected user updates', () => {
  const originalUpdatedAt = new Date('2026-09-15T08:00:00.000Z');
  let current: any;
  let tx: any;
  let prisma: any;
  let service: AdminUsersService;

  beforeEach(() => {
    current = {
      id: 7,
      email: 'customer@example.test',
      password: null,
      name: 'Original Name',
      phone: '+34600000000',
      firstName: 'Original',
      lastName: 'Name',
      memberCode: '000007',
      publicMemberToken: null,
      sessionVersion: 3,
      newsletterSubscribed: false,
      firstOrderDiscountCode: null,
      firstOrderDiscountUsed: false,
      circleLevel: 2,
      role: Role.USER,
      accountState: UserAccountState.ACTIVE,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: originalUpdatedAt,
      lastLoginAt: null,
      addresses: [{ id: 31, phone: '+34910000000', isDefault: true }],
    };
    tx = {
      user: {
        findUnique: jest.fn(() => ({
          ...current,
          addresses: [...current.addresses],
        })),
        count: jest.fn().mockResolvedValue(2),
        updateMany: jest.fn(({ data }) => {
          current = {
            ...current,
            ...data,
            sessionVersion:
              data.sessionVersion?.increment != null
                ? current.sessionVersion + data.sessionVersion.increment
                : current.sessionVersion,
          };
          return { count: 1 };
        }),
      },
      address: {
        update: jest.fn(({ data }) => {
          current.addresses[0] = { ...current.addresses[0], ...data };
          return current.addresses[0];
        }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 1 }) },
    };
    prisma = {
      $transaction: jest.fn(async (callback) => {
        const snapshot = {
          ...current,
          addresses: current.addresses.map((address: any) => ({ ...address })),
        };
        try {
          return await callback(tx);
        } catch (error) {
          current = snapshot;
          throw error;
        }
      }),
      user: { findUnique: jest.fn() },
    };
    service = new AdminUsersService(prisma);
  });

  const update = (payload: Record<string, unknown>) =>
    service.updateAdminUser(
      7,
      { expectedUpdatedAt: originalUpdatedAt.toISOString(), ...payload },
      1,
      { ip: '127.0.0.1', userAgent: 'jest', requestId: 'request-1' },
    );

  it('offers exactly the canonical assignable roles', () => {
    expect(service.getEditOptions().roles).toEqual([
      Role.USER,
      Role.FRIEND,
      Role.ADMIN,
      Role.SUPERADMIN,
    ]);
  });

  it('edits name', async () => {
    await expect(update({ name: 'Updated Name' })).resolves.toMatchObject({
      name: 'Updated Name',
    });
  });

  it('normalizes and edits the authoritative account phone', async () => {
    await expect(update({ phone: '+34 611-222-333' })).resolves.toMatchObject({
      phone: '+34611222333',
    });
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ phone: '+34611222333' }),
      }),
    );
    expect(tx.address.update).not.toHaveBeenCalled();
  });

  it('changes account status and invalidates existing sessions', async () => {
    await update({ accountState: UserAccountState.PENDING_PASSWORD });
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          accountState: UserAccountState.PENDING_PASSWORD,
          sessionVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('assigns another supported circle atomically', async () => {
    await expect(update({ circleLevel: 4 })).resolves.toMatchObject({
      circle: 4,
    });
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it.each([
    [Role.USER, Role.FRIEND],
    [Role.FRIEND, Role.ADMIN],
    [Role.USER, Role.SUPERADMIN],
    [Role.ADMIN, Role.USER],
  ])('changes role %s to %s and revokes old tokens', async (from, to) => {
    current.role = from;
    await expect(update({ role: to })).resolves.toMatchObject({ role: to });
    expect(tx.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: to,
          sessionVersion: { increment: 1 },
        }),
      }),
    );
  });

  it('stores changed fields and exact before/after values in audit', async () => {
    await update({ name: 'Audit Name', circleLevel: 3 });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1,
        actionType: 'admin.user.update',
        targetType: 'user',
        targetId: '7',
        fromCircle: 2,
        toCircle: 3,
        metadata: expect.objectContaining({
          changedFields: ['name', 'circleLevel'],
          before: expect.objectContaining({
            name: 'Original Name',
            circleLevel: 2,
          }),
          after: expect.objectContaining({
            name: 'Audit Name',
            circleLevel: 3,
          }),
        }),
      }),
    });
  });

  it('rolls back the user update when audit persistence fails', async () => {
    tx.auditLog.create.mockRejectedValue(new Error('audit unavailable'));
    await expect(update({ name: 'No success' })).rejects.toThrow(
      'audit unavailable',
    );
    expect(current.name).toBe('Original Name');
  });

  it('returns a clear conflict for stale UI data', async () => {
    await expect(
      service.updateAdminUser(
        7,
        {
          name: 'Stale',
          expectedUpdatedAt: '2026-09-14T08:00:00.000Z',
        },
        1,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });

  it('detects a concurrent write at compare-and-update time', async () => {
    tx.user.updateMany.mockResolvedValue({ count: 0 });
    await expect(update({ name: 'Race' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('preserves the final active Super Admin protection', async () => {
    current.role = Role.SUPERADMIN;
    tx.user.count.mockResolvedValue(1);
    await expect(update({ role: Role.ADMIN })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('sets a phone when the user has no address without fabricating one', async () => {
    current.addresses = [];
    await expect(update({ phone: '+34 600 111 222' })).resolves.toMatchObject({
      phone: '+34600111222',
    });
    expect(current.addresses).toEqual([]);
    expect(tx.address.update).not.toHaveBeenCalled();
  });

  it('removes the nullable account phone without changing delivery data', async () => {
    await expect(update({ phone: null })).resolves.toMatchObject({
      phone: null,
    });
    expect(current.addresses[0].phone).toBe('+34910000000');
    expect(tx.address.update).not.toHaveBeenCalled();
  });

  it('keeps an existing delivery phone unchanged when account phone changes', async () => {
    await update({ phone: '+44 (0) 20 7946 0958' });
    expect(current.phone).toBe('+4402079460958');
    expect(current.addresses[0].phone).toBe('+34910000000');
  });

  it('audits exact previous and new account phone values and request metadata', async () => {
    await update({ phone: '+1 (202) 555-0184' });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorId: 1,
        targetId: '7',
        metadata: expect.objectContaining({
          changedFields: ['phone'],
          before: expect.objectContaining({ phone: '+34600000000' }),
          after: expect.objectContaining({ phone: '+12025550184' }),
          request: {
            ip: '127.0.0.1',
            userAgent: 'jest',
            requestId: 'request-1',
          },
        }),
      }),
    });
  });

  it('does not create an audit entry when user persistence fails', async () => {
    tx.user.updateMany.mockRejectedValue(new Error('user unavailable'));
    await expect(update({ phone: '+12025550184' })).rejects.toThrow(
      'user unavailable',
    );
    expect(current.phone).toBe('+34600000000');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it.each(['34+600111222', '+12 34 letters', '+123'])(
    'rejects malformed international phone %s',
    async (phone) => {
      await expect(update({ phone })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );

  it('returns the same account phone in the list and detail endpoints', async () => {
    const accountUser = { ...current, phone: '+12025550184', addresses: [] };
    const readPrisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([accountUser]),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(accountUser),
      },
      order: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: null } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      circleUpgradeRequest: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      promoCodeRedemption: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((operations) => Promise.all(operations)),
    };
    const readService = new AdminUsersService(readPrisma as any);

    const list = await readService.listUsers({});
    const detail = await readService.getUserById(accountUser.id);

    expect(list.data[0].phone).toBe('+12025550184');
    expect(detail.user.phone).toBe('+12025550184');
    expect(readPrisma.user.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ include: expect.anything() }),
    );
  });
});
