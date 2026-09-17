/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { UnauthorizedException } from '@nestjs/common';
import { Role, UserAccountState } from '@prisma/client';
import type { Request } from 'express';
import { JwtAccessStrategy } from './jwt-access.strategy';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';

describe('role/status session invalidation', () => {
  const originalAccessSecret = process.env.JWT_ACCESS_SECRET;
  const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
  const usersService = {
    findById: jest.fn(),
    toSafeUser: jest.fn((user) => ({ id: user.id, role: user.role })),
  };
  const sessions = { validate: jest.fn(), verify: jest.fn() };
  let access: JwtAccessStrategy;
  let refresh: JwtRefreshStrategy;

  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET =
      'access-test-secret-at-least-thirty-two-characters';
    process.env.JWT_REFRESH_SECRET =
      'refresh-test-secret-at-least-thirty-two-characters';
    access = new JwtAccessStrategy(usersService as never, sessions as never);
    refresh = new JwtRefreshStrategy(usersService as never, sessions as never);
  });

  afterAll(() => {
    if (originalAccessSecret === undefined)
      delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalAccessSecret;
    if (originalRefreshSecret === undefined)
      delete process.env.JWT_REFRESH_SECRET;
    else process.env.JWT_REFRESH_SECRET = originalRefreshSecret;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.validate.mockResolvedValue({ lastActivityAt: new Date() });
    sessions.verify.mockResolvedValue({ id: 'session-1' });
  });

  it('rejects an existing access token after a role change increments sessionVersion', async () => {
    usersService.findById.mockResolvedValue({
      id: 7,
      role: Role.USER,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 4,
    });
    await expect(
      access.validate({} as Request, { sub: 7, sv: 3 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects an existing refresh token after demotion', async () => {
    usersService.findById.mockResolvedValue({
      id: 7,
      role: Role.USER,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 4,
    });
    const request = { refreshToken: 'old-refresh' } as unknown as Request;
    await expect(
      refresh.validate(request, { sub: 7, sv: 3, type: 'refresh' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects inactive accounts immediately for both token types', async () => {
    usersService.findById.mockResolvedValue({
      id: 7,
      role: Role.ADMIN,
      accountState: UserAccountState.PENDING_PASSWORD,
      sessionVersion: 3,
    });
    await expect(
      access.validate({} as Request, { sub: 7, sv: 3 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      refresh.validate({ refreshToken: 'refresh' } as unknown as Request, {
        sub: 7,
        sv: 3,
        type: 'refresh',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps FRIEND authenticated for ordinary non-admin functionality', async () => {
    usersService.findById.mockResolvedValue({
      id: 7,
      role: Role.FRIEND,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    });
    await expect(
      access.validate({} as Request, { sub: 7, sv: 3 }),
    ).resolves.toEqual({ id: 7, role: Role.FRIEND });
  });
});
