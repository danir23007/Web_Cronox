import { UnauthorizedException } from '@nestjs/common';
import { Role, UserAccountState } from '@prisma/client';
import type { Request } from 'express';
import { AuthSessionsService } from '../auth-sessions.service';
import { JwtAccessStrategy } from './jwt-access.strategy';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';

describe('role/status session invalidation with the authoritative session read', () => {
  const users = {
    findById: jest.fn(),
    toSafeUser: jest.fn((user) => ({ id: user.id, role: user.role })),
  };
  const claims = { sub: 7, sv: 3, sid: 'session-1', type: 'access' };
  let current: {
    id: number;
    role: Role;
    accountState: UserAccountState;
    sessionVersion: number;
  };
  let revoked: Date | null;
  let access: JwtAccessStrategy, refresh: JwtRefreshStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    current = {
      id: 7,
      role: Role.USER,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    };
    revoked = null;
    const service = new AuthSessionsService({
      authSession: {
        findUnique: jest.fn(async () => ({
          id: 'session-1',
          userId: 7,
          sessionVersion: 3,
          revokedAt: revoked,
          lastActivityAt: new Date(),
          refreshIssuedAt: Math.floor(Date.now() / 1000),
          user: current,
        })),
      },
    } as never);
    // Signature/hash verification has separate SDK/HTTP tests. This fixture
    // exercises the real database-state validation shared by both strategies.
    const sessions = {
      validate: service.validate.bind(service),
      verify: () => service.validate(claims),
    };
    access = new JwtAccessStrategy(users as never, sessions as never);
    refresh = new JwtRefreshStrategy(users as never, sessions as never);
  });

  it.each(['version', 'inactive', 'revoked'])(
    'rejects both token types after %s changes, without a second user lookup',
    async (reason) => {
      if (reason === 'version') current.sessionVersion = 4;
      if (reason === 'inactive')
        current.accountState = UserAccountState.PENDING_PASSWORD;
      if (reason === 'revoked') revoked = new Date();
      await expect(
        access.validate({} as Request, claims),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(
        refresh.validate({ refreshToken: 'fixture' } as unknown as Request, {
          sub: 7,
          sv: 3,
          type: 'refresh',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(users.findById).not.toHaveBeenCalled();
    },
  );

  it('preserves FRIEND access and uses the current database role, not the JWT role', async () => {
    current.role = Role.FRIEND;
    await expect(access.validate({} as Request, claims)).resolves.toEqual({
      id: 7,
      role: Role.FRIEND,
    });
    current.role = Role.USER;
    await expect(access.validate({} as Request, claims)).resolves.toEqual({
      id: 7,
      role: Role.USER,
    });
    expect(users.findById).not.toHaveBeenCalled();
  });
});
