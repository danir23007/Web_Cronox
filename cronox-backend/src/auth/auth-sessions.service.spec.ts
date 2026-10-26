/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { UnauthorizedException } from '@nestjs/common';
import { Role, UserAccountState } from '@prisma/client';
import {
  AuthSessionsService,
  ACTIVITY_WRITE_MS,
  REFRESH_RACE_MS,
  SESSION_IDLE_MS,
} from './auth-sessions.service';
import {
  ACCESS_TOKEN_SECONDS,
  ADMIN_REFRESH_SECONDS,
  PERSISTENT_SESSION_SECONDS,
} from './session-policy';

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
      if (
        where.refreshIssuedAt?.gt !== undefined &&
        row.refreshIssuedAt <= where.refreshIssuedAt.gt
      )
        return false;
      if (
        typeof where.refreshIssuedAt === 'number' &&
        row.refreshIssuedAt !== where.refreshIssuedAt
      )
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

  it.each([Role.USER, Role.FRIEND, Role.SUPERADMIN])(
    'gives %s a rolling 500-day server session and a 15-minute access JWT',
    async (role) => {
      user.role = role;
      const first = await service.create(user);
      const session = [...records.values()][0];
      const accessPayload = JSON.parse(
        Buffer.from(first.accessToken.split('.')[1], 'base64url').toString(),
      ) as { exp: number; iat: number };
      expect(accessPayload.exp - accessPayload.iat).toBe(ACCESS_TOKEN_SECONDS);
      expect(first.idleExpiresAt).toBeUndefined();
      expect(first.refreshExpiresAt.getTime()).toBe(
        (session.refreshIssuedAt + PERSISTENT_SESSION_SECONDS) * 1000,
      );

      jest.setSystemTime(now + (PERSISTENT_SESSION_SECONDS - 120) * 1000);
      await expect(
        service.verify(first.refreshToken, 'refresh'),
      ).resolves.toBeTruthy();
      const passive = await service.rotate(first.refreshToken);
      if (role !== Role.SUPERADMIN)
        expect(passive.refreshExpiresAt).toEqual(first.refreshExpiresAt);
      const renewed =
        role === Role.SUPERADMIN
          ? passive
          : (await service.visit({
              sub: user.id,
              sv: user.sessionVersion,
              sid: session.id,
              type: 'access',
            }))!;
      expect(renewed.refreshExpiresAt.getTime()).toBe(
        (session.refreshIssuedAt + PERSISTENT_SESSION_SECONDS) * 1000,
      );
      expect(renewed.refreshExpiresAt.getTime()).toBeGreaterThan(
        first.refreshExpiresAt.getTime(),
      );
      await expect(
        service.verify(renewed.refreshToken, 'refresh'),
      ).resolves.toBeTruthy();
    },
  );

  it('rejects a persistent session unused beyond 500 days', async () => {
    const first = await service.create(user);
    jest.setSystemTime(now + (PERSISTENT_SESSION_SECONDS + 1) * 1000);
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps the existing seven-day refresh lifetime for ADMIN and does not renew on passive refresh validation', async () => {
    user.role = Role.ADMIN;
    const first = await service.create(user);
    const session = [...records.values()][0];
    expect(first.refreshExpiresAt.getTime()).toBe(
      (session.refreshIssuedAt + ADMIN_REFRESH_SECONDS) * 1000,
    );
    expect(first.idleExpiresAt).toBe(now + SESSION_IDLE_MS);
    jest.setSystemTime(now + 89 * 60_000);
    await service.verify(first.refreshToken, 'refresh');
    expect(session.lastActivityAt.getTime()).toBe(now);
    await service.rotate(first.refreshToken);
    expect(session.lastActivityAt.getTime()).toBe(now);
    jest.setSystemTime(now + 90 * 60_000 + 1);
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).rejects.toMatchObject({
      response: { code: 'SESSION_IDLE' },
    });
  });

  it('does not apply the ADMIN idle timeout to SUPERADMIN', async () => {
    user.role = Role.SUPERADMIN;
    const first = await service.create(user);
    jest.setSystemTime(now + 91 * 60_000);
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).resolves.toBeTruthy();
  });

  it('keeps ADMIN valid at 89 minutes and rejects/revokes after more than 90 minutes', async () => {
    user.role = Role.ADMIN;
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
    user.role = Role.ADMIN;
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
    user.role = Role.ADMIN;
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

  it('revokes only the logged-out device while the other device refreshes', async () => {
    const deviceA = await service.create(user);
    const idA = [...records.keys()][0];
    const deviceB = await service.create(user);
    await service.revoke(idA);
    await expect(
      service.verify(deviceA.refreshToken, 'refresh'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const renewedB = await service.rotate(deviceB.refreshToken);
    await expect(
      service.verify(renewedB.refreshToken, 'refresh'),
    ).resolves.toBeTruthy();
    expect(user.sessionVersion).toBe(3);
  });

  it.each([Role.USER, Role.FRIEND, Role.ADMIN, Role.SUPERADMIN])(
    'handles %s refresh races without authenticating stale credentials',
    async (role) => {
      user.role = role;
      const original = await service.create(user);
      const winner = await service.rotate(original.refreshToken);
      const racing = await service.rotate(original.refreshToken);
      expect(racing.refreshToken).toBe(winner.refreshToken);
      jest.advanceTimersByTime(REFRESH_RACE_MS + 1);
      if (role === Role.USER || role === Role.FRIEND) {
        await expect(
          service.rotate(original.refreshToken),
        ).rejects.toMatchObject({
          response: { code: 'REFRESH_RETRY' },
        });
        expect([...records.values()][0].revokedAt).toBeNull();
        await expect(service.rotate(winner.refreshToken)).resolves.toBeTruthy();
      } else {
        await expect(
          service.rotate(original.refreshToken),
        ).rejects.toBeInstanceOf(UnauthorizedException);
        expect([...records.values()][0].revokedAt).toBeInstanceOf(Date);
      }
    },
  );

  it.each([Role.USER, Role.FRIEND])(
    'renews only the visited %s device, persists, and expires after 500 inactive days',
    async (role) => {
      user.role = role;
      await service.create(user);
      const id = [...records.keys()][0];
      const other = await service.create(user);
      jest.setSystemTime(now + 400 * 86400_000);
      const [one, two] = await Promise.all([
        service.visit({ sub: 7, sv: 3, sid: id }),
        service.visit({ sub: 7, sv: 3, sid: id }),
      ]);
      expect(one!.refreshToken).toBe(two!.refreshToken);
      expect(one!.refreshExpiresAt.getTime()).toBe(
        Date.now() + PERSISTENT_SESSION_SECONDS * 1000,
      );
      const reloaded = new AuthSessionsService(prisma);
      await expect(
        reloaded.verify(one!.refreshToken, 'refresh'),
      ).resolves.toBeTruthy();
      expect(records.get(id).lastActivityAt.getTime()).toBe(Date.now());
      jest.advanceTimersByTime(101 * 86400_000);
      await expect(
        reloaded.verify(other.refreshToken, 'refresh'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        reloaded.verify(one!.refreshToken, 'refresh'),
      ).resolves.toBeTruthy();
      jest.advanceTimersByTime(399 * 86400_000);
      await expect(
        reloaded.verify(one!.refreshToken, 'refresh'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    },
  );

  it.each([Role.ADMIN, Role.SUPERADMIN])(
    'does not change %s policies through customer visits',
    async (role) => {
      user.role = role;
      await service.create(user);
      jest.advanceTimersByTime(1000);
      await expect(
        service.visit({ sub: 7, sv: 3, sid: [...records.keys()][0] }),
      ).resolves.toBeNull();
      expect(writes).toBe(0);
    },
  );

  it('invalidates a session after password/version changes or account disablement', async () => {
    const first = await service.create(user);
    user.sessionVersion++;
    await expect(
      service.verify(first.refreshToken, 'refresh'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    user.sessionVersion--;
    user.accountState = UserAccountState.INACTIVE;
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

  it('coalesces nearby customer visits and retains the refresh returned just before a visit', async () => {
    const original = await service.create(user);
    const claims = { sub: 7, sv: 3, sid: [...records.keys()][0] };
    jest.advanceTimersByTime(20_000);
    const refreshed = await service.rotate(original.refreshToken);
    const visited = (await service.visit(claims))!;
    await expect(service.verify(refreshed.refreshToken, 'refresh')).resolves.toBeTruthy();
    jest.advanceTimersByTime(2000);
    const secondVisit = (await service.visit(claims))!;
    expect(secondVisit.refreshToken).toBe(visited.refreshToken);
    await expect(service.rotate(refreshed.refreshToken)).resolves.toMatchObject({ refreshToken: visited.refreshToken });
    jest.advanceTimersByTime(REFRESH_RACE_MS);
    await expect(service.rotate(refreshed.refreshToken)).rejects.toMatchObject({ response: { code: 'REFRESH_RETRY' } });
    expect([...records.values()][0].revokedAt).toBeNull();
  });

  it('stores only a refresh-token hash and deletes no user or cart data', async () => {
    const tokens = await service.create(user);
    const row = [...records.values()][0];
    expect(row.refreshHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toContain(tokens.refreshToken);
    expect(prisma.authSession.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not revoke a customer renewed while an expiry check was reading its old generation', async () => {
    await service.create(user);
    const row = [...records.values()][0];
    row.refreshIssuedAt -= PERSISTENT_SESSION_SECONDS + 1;
    const update = prisma.authSession.updateMany.getMockImplementation();
    prisma.authSession.updateMany.mockImplementationOnce(async (args: any) => {
      row.generation++;
      row.refreshIssuedAt = Math.floor(Date.now() / 1000);
      return update(args);
    });
    await expect(
      service.validate({ sub: 7, sv: 3, sid: row.id }),
    ).resolves.toMatchObject({ revokedAt: null });
    expect(row.revokedAt).toBeNull();
  });

  it('uses one replacement family for genuinely parallel refresh requests', async () => {
    const original = await service.create(user);
    const replies = await Promise.all(
      Array.from({ length: 8 }, () => service.rotate(original.refreshToken)),
    );
    expect(new Set(replies.map((r) => r.refreshToken)).size).toBe(1);
    expect([...records.values()][0].generation).toBe(1);
    expect([...records.values()][0].revokedAt).toBeNull();
  });
});
