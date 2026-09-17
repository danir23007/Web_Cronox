/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { UnauthorizedException } from '@nestjs/common';
import { Role, UserAccountState } from '@prisma/client';
import {
  AuthSessionsService,
  ACTIVITY_WRITE_MS,
  REFRESH_RACE_MS,
  SESSION_IDLE_MS,
} from './auth-sessions.service';

describe('server-authoritative sliding auth sessions', () => {
  const originalEnv = { ...process.env };
  let now: number;
  let user: {
    id: number;
    role: Role;
    accountState: UserAccountState;
    sessionVersion: number;
  };
  let records: Map<string, any>;
  let writes: number;
  let prisma: any;
  let service: AuthSessionsService;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET =
      'access-test-secret-at-least-thirty-two-characters';
    process.env.JWT_REFRESH_SECRET =
      'refresh-test-secret-at-least-thirty-two-characters';
    now = Date.parse('2026-09-17T08:00:00.000Z');
    jest.useFakeTimers().setSystemTime(now);
    user = {
      id: 7,
      role: Role.USER,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    };
    records = new Map();
    writes = 0;
    const matches = (row: any, where: any) => {
      if (where.id && row.id !== where.id) return false;
      if (where.generation !== undefined && row.generation !== where.generation)
        return false;
      if (where.revokedAt === null && row.revokedAt !== null) return false;
      if (
        where.lastActivityAt?.gt &&
        row.lastActivityAt <= where.lastActivityAt.gt
      )
        return false;
      if (
        where.lastActivityAt?.lte &&
        row.lastActivityAt > where.lastActivityAt.lte
      )
        return false;
      if (
        where.user &&
        (user.sessionVersion !== where.user.sessionVersion ||
          user.accountState !== where.user.accountState)
      )
        return false;
      return true;
    };
    prisma = {
      authSession: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            ...data,
            createdAt: new Date(),
            revokedAt: null,
            previousRefreshHash: null,
            previousValidUntil: null,
          };
          records.set(row.id, row);
          return { ...row };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
          const row = records.get(where.id);
          return row ? { ...row, user: { ...user } } : null;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = records.get(where.id);
          if (!row || !matches(row, where)) return { count: 0 };
          Object.assign(row, data);
          writes++;
          return { count: 1 };
        }),
      },
    };
    service = new AuthSessionsService(prisma);
  });

  afterEach(() => {
    jest.useRealTimers();
    for (const key of Object.keys(process.env))
      if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });

  it.each([Role.USER, Role.FRIEND, Role.ADMIN, Role.SUPERADMIN])(
    'keeps an active %s session valid beyond access-token refreshes',
    async (role) => {
      user.role = role;
      const first = await service.create(user);
      expect(first.refreshToken).toBeTruthy();
      jest.advanceTimersByTime(16 * 60_000);
      const rotated = await service.rotate(first.refreshToken);
      expect(rotated.refreshToken).not.toBe(first.refreshToken);
      await expect(
        service.verify(rotated.refreshToken, 'refresh'),
      ).resolves.toMatchObject({ userId: 7 });
    },
  );

  it('allows refresh at 89 minutes and rejects/revokes after more than 90 minutes', async () => {
    const first = await service.create(user);
    jest.advanceTimersByTime(89 * 60_000);
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).resolves.toBeTruthy();
    jest.advanceTimersByTime(61_000);
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).rejects.toMatchObject({
      response: {
        code: 'SESSION_IDLE',
        message: 'Tu sesión se ha cerrado por inactividad.',
      },
    });
    expect([...records.values()][0].revokedAt).toBeInstanceOf(Date);
  });

  it('touches atomically only after the write throttle and resets the idle deadline', async () => {
    const first = await service.create(user);
    const claims = {
      sub: 7,
      sv: 3,
      sid: [...records.keys()][0],
      type: 'access',
    };
    jest.advanceTimersByTime(ACTIVITY_WRITE_MS - 1);
    const unchanged = await service.touch(claims);
    expect(writes).toBe(0);
    jest.advanceTimersByTime(2);
    const touched = await service.touch(claims);
    expect(writes).toBe(1);
    expect(touched.idleExpiresAt).toBeGreaterThan(unchanged.idleExpiresAt);
    jest.advanceTimersByTime(89 * 60_000);
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).resolves.toBeTruthy();
  });

  it('gives separate devices independent inactivity deadlines', async () => {
    const deviceA = await service.create(user);
    const idA = [...records.keys()][0];
    jest.advanceTimersByTime(2 * 60_000);
    const deviceB = await service.create(user);
    records.get(idA).lastActivityAt = new Date(
      Date.now() - SESSION_IDLE_MS - 1,
    );
    await expect(
      service.verify(deviceA.refreshToken, 'refresh'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.verify(deviceB.refreshToken, 'refresh'),
    ).resolves.toBeTruthy();
  });

  it('returns one rotation result during a tab race and revokes replay outside grace', async () => {
    const original = await service.create(user);
    const winner = await service.rotate(original.refreshToken);
    const racing = await service.rotate(original.refreshToken);
    expect(racing.refreshToken).toBe(winner.refreshToken);
    jest.advanceTimersByTime(REFRESH_RACE_MS + 1);
    await expect(service.rotate(original.refreshToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect([...records.values()][0].revokedAt).toBeInstanceOf(Date);
  });

  it('invalidates a session after password/version changes or account disablement', async () => {
    const first = await service.create(user);
    user.sessionVersion++;
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    user.sessionVersion--;
    user.accountState = UserAccountState.DISABLED;
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects legacy refresh JWTs without a session id in a controlled way', async () => {
    await expect(
      service.validate({ sub: 7, sv: 3, type: 'refresh' }),
    ).rejects.toMatchObject({
      response: { code: 'SESSION_REAUTH_REQUIRED' },
    });
  });

  it('stores only a refresh-token hash and deletes no user or cart data', async () => {
    const tokens = await service.create(user);
    const row = [...records.values()][0];
    expect(row.refreshHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(tokens.refreshToken);
    expect(prisma.authSession.deleteMany).toHaveBeenCalledTimes(1);
  });
});
