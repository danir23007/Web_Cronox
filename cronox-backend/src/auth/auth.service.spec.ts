import { createHash } from 'crypto';
import { Role, UserAccountState } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService password reset security', () => {
  const originalEnvironment = { ...process.env };
  const usersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    createUser: jest.fn(),
    toSafeUser: jest.fn((user) => user),
  };
  const jwtService = { verifyAsync: jest.fn() };
  const refreshJwt = { verifyAsync: jest.fn() };
  const cartService = {};
  const emailService = {
    isEnabled: jest.fn(),
    sendPasswordReset: jest.fn(),
    sendInitialPasswordSetup: jest.fn(),
  };
  const newsletterService = { subscribeIfNeeded: jest.fn() };
  const sessions = {
    create: jest.fn(),
    verify: jest.fn(),
    rotate: jest.fn(),
    touch: jest.fn(),
    revoke: jest.fn(),
  };

  let tx: any;
  let prisma: any;
  let service: AuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.BCRYPT_SALT_ROUNDS = '10';
    sessions.verify.mockResolvedValue({
      id: 'session-1',
      userId: 42,
      sessionVersion: 3,
      lastActivityAt: new Date(),
    });
    sessions.revoke.mockResolvedValue(undefined);

    tx = {
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      user: {
        update: jest.fn().mockResolvedValue({ id: 42 }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      cart: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({ id: 9 }),
      },
      checkoutSnapshot: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      authSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: (client: unknown) => unknown) =>
        callback(tx),
      ),
      passwordResetToken: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
    };
    service = new AuthService(
      usersService as any,
      jwtService as any,
      refreshJwt as any,
      cartService as any,
      prisma,
      emailService as any,
      newsletterService as any,
      sessions as any,
    );
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
  });

  it('records a successful login as coarse client information only', async () => {
    prisma.userLoginEvent = {
      create: jest.fn().mockResolvedValue({ id: 'login-1' }),
    };
    prisma.user.update = jest.fn().mockResolvedValue({ id: 42 });
    prisma.$transaction = jest.fn(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );

    await service.recordSuccessfulLogin(42, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36',
      },
    } as any);

    expect(prisma.userLoginEvent.create).toHaveBeenCalledWith({
      data: {
        userId: 42,
        browserFamily: 'Chrome',
        browserMajorVersion: '126',
        osFamily: 'Windows',
        deviceClass: 'DESKTOP',
      },
    });
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 42 } }),
    );
  });

  it('stores only a hash and sends the raw token exclusively in the reset link', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 42,
      email: 'member@example.test',
    });
    emailService.isEnabled.mockReturnValue(true);

    await expect(
      service.requestPasswordReset('MEMBER@example.test'),
    ).resolves.toEqual({ ok: true });
    await new Promise<void>((resolve) => setImmediate(resolve));

    const rawToken = new URL(
      emailService.sendPasswordReset.mock.calls[0][1],
    ).searchParams.get('token');
    const storedToken =
      tx.passwordResetToken.create.mock.calls[0][0].data.token;

    expect(rawToken).toBeTruthy();
    expect(storedToken).toBe(
      createHash('sha256')
        .update(rawToken as string)
        .digest('hex'),
    );
    expect(storedToken).not.toBe(rawToken);
    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42, usedAt: null } }),
    );
  });

  it('does not create a token when reset email delivery is disabled', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 42,
      email: 'member@example.test',
    });
    emailService.isEnabled.mockReturnValue(false);

    await expect(
      service.requestPasswordReset('member@example.test'),
    ).resolves.toEqual({ ok: true });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('returns the same generic response without awaiting reset persistence or SMTP work', async () => {
    usersService.findByEmail.mockResolvedValue({
      id: 42,
      email: 'member@example.test',
    });
    emailService.isEnabled.mockReturnValue(true);
    prisma.$transaction.mockImplementation(() => new Promise(() => undefined));

    await expect(
      service.requestPasswordReset('member@example.test'),
    ).resolves.toEqual({ ok: true });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('consumes the hashed token atomically and increments sessionVersion', async () => {
    const rawToken = 'token-that-was-only-delivered-by-email';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 11,
      userId: 42,
      token: tokenHash,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      service.resetPassword(rawToken, 'ValidPassword1'),
    ).resolves.toEqual({ ok: true });

    expect(tx.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 11,
          token: tokenHash,
          usedAt: null,
        }),
      }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sessionVersion: { increment: 1 } }),
      }),
    );
  });

  it('claims and sends one secure initial-password link for a passwordless account', async () => {
    emailService.isEnabled.mockReturnValue(true);
    prisma.user.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    prisma.user.findUnique.mockResolvedValue({
      id: 42,
      email: 'new@example.test',
      password: null,
    });

    await service.sendInitialPasswordSetupIfNeeded(42);
    await service.sendInitialPasswordSetupIfNeeded(42);

    expect(emailService.sendInitialPasswordSetup).toHaveBeenCalledTimes(1);
    const setupUrl = emailService.sendInitialPasswordSetup.mock.calls[0][1];
    const rawToken = new URL(setupUrl).searchParams.get('token');
    const storedToken =
      tx.passwordResetToken.create.mock.calls[0][0].data.token;
    expect(storedToken).toBe(
      createHash('sha256')
        .update(rawToken as string)
        .digest('hex'),
    );
    const expiresAt = tx.passwordResetToken.create.mock.calls[0][0].data
      .expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(
      Date.now() + 60 * 60 * 1000,
    );
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 42, password: null }),
        data: expect.objectContaining({
          passwordSetupEmailSentAt: expect.any(Date),
        }),
      }),
    );
  });

  it('releases the setup-email claim without invalidating the account when delivery fails', async () => {
    emailService.isEnabled.mockReturnValue(true);
    emailService.sendInitialPasswordSetup.mockRejectedValue(new Error('SMTP'));
    prisma.user.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({
      id: 42,
      email: 'new@example.test',
      password: null,
    });

    await expect(
      service.sendInitialPasswordSetupIfNeeded(42),
    ).resolves.toBeUndefined();

    expect(prisma.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 42, usedAt: null }),
      }),
    );
    expect(prisma.user.updateMany).toHaveBeenLastCalledWith({
      where: { id: 42, password: null, passwordSetupEmailSentAt: null },
      data: { passwordSetupClaimedAt: null },
    });
  });

  it('does not grant login to an automatically-created account before a password is set', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 42,
      email: 'new@example.test',
      password: null,
    });

    await expect(
      service.validateUser(' NEW@example.test ', 'any-password'),
    ).resolves.toBeNull();
  });

  it('sends no setup email for an existing password-configured account', async () => {
    emailService.isEnabled.mockReturnValue(true);
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    await service.sendInitialPasswordSetupIfNeeded(42);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(emailService.sendInitialPasswordSetup).not.toHaveBeenCalled();
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('enables ordinary password validation after consuming the initial setup token', async () => {
    const rawToken = 'initial-account-token';
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    prisma.passwordResetToken.findUnique.mockResolvedValue({
      id: 12,
      userId: 42,
      token: tokenHash,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    let persistedHash: string | null = null;
    tx.user.update.mockImplementation(({ data }: any) => {
      persistedHash = data.password;
      return { id: 42 };
    });

    await service.resetPassword(rawToken, 'ValidPassword1');
    prisma.user.findFirst.mockImplementation(() =>
      Promise.resolve({
        id: 42,
        email: 'new@example.test',
        password: persistedHash,
        role: 'USER',
        accountState: UserAccountState.ACTIVE,
        sessionVersion: 1,
      }),
    );

    await expect(
      service.validateUser('NEW@example.test', 'ValidPassword1'),
    ).resolves.toMatchObject({ id: 42, email: 'new@example.test' });
  });

  it('revokes a validated access session during idempotent logout', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 42, sv: 3 });

    await expect(
      service.logout('access-token', undefined),
    ).resolves.toBeUndefined();

    expect(sessions.revoke).toHaveBeenCalledWith('session-1');
  });

  it('accepts an access session only after verifying its current administrative user', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 42, sv: 3 });
    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.ADMIN,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    });

    await expect(
      service.hasValidAdminSession('valid-access-token'),
    ).resolves.toBe(true);
    expect(usersService.findById).toHaveBeenCalledWith(42);
  });

  it('accepts an expired access cookie through a valid current administrator refresh session', async () => {
    sessions.verify
      .mockRejectedValueOnce(new Error('access expired'))
      .mockResolvedValueOnce({
        id: 'session-1',
        userId: 42,
        sessionVersion: 3,
      });
    jwtService.verifyAsync.mockRejectedValue(new Error('access expired'));
    refreshJwt.verifyAsync.mockResolvedValue({
      sub: 42,
      sv: 3,
      type: 'refresh',
    });
    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.SUPERADMIN,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    });

    await expect(
      service.hasValidAdminSession('expired-access', 'valid-refresh'),
    ).resolves.toBe(true);
    expect(sessions.verify).toHaveBeenNthCalledWith(
      1,
      'expired-access',
      'access',
    );
    expect(sessions.verify).toHaveBeenNthCalledWith(
      2,
      'valid-refresh',
      'refresh',
    );
    expect(usersService.findById).toHaveBeenCalledWith(42);
  });

  it('accepts a valid current administrator refresh session without an access cookie', async () => {
    refreshJwt.verifyAsync.mockResolvedValue({
      sub: 42,
      sv: 3,
      type: 'refresh',
    });
    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.ADMIN,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    });

    await expect(
      service.hasValidAdminSession(undefined, 'valid-refresh'),
    ).resolves.toBe(true);
    expect(sessions.verify).toHaveBeenCalledWith('valid-refresh', 'refresh');
  });

  it('rejects a valid session when the current database role is not administrative', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 42, sv: 3 });
    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.USER,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    });

    await expect(
      service.hasValidAdminSession('user-access-token'),
    ).resolves.toBe(false);
  });

  it('rejects a session invalidated by a changed session version or role', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 42, sv: 3 });
    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.SUPERADMIN,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 4,
    });

    await expect(
      service.hasValidAdminSession('stale-access-token'),
    ).resolves.toBe(false);
  });

  it('rejects a refresh session invalidated by a changed session version', async () => {
    refreshJwt.verifyAsync.mockResolvedValue({
      sub: 42,
      sv: 3,
      type: 'refresh',
    });
    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.SUPERADMIN,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 4,
    });

    await expect(
      service.hasValidAdminSession(undefined, 'stale-refresh'),
    ).resolves.toBe(false);
  });

  it.each(['forged', 'expired', 'invalid'])(
    'fails closed for a %s access cookie without raising an application error',
    async () => {
      sessions.verify.mockRejectedValue(new Error('invalid token'));

      await expect(
        service.hasValidAdminSession('untrusted-token'),
      ).resolves.toBe(false);
      expect(usersService.findById).not.toHaveBeenCalled();
    },
  );

  it('rejects a refresh cookie signed with the wrong secret without raising an application error', async () => {
    sessions.verify.mockRejectedValue(new Error('invalid signature'));
    refreshJwt.verifyAsync.mockRejectedValue(new Error('invalid signature'));

    await expect(
      service.hasValidAdminSession(undefined, 'wrong-secret-refresh'),
    ).resolves.toBe(false);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('never treats a refresh token as an access token', async () => {
    sessions.verify.mockRejectedValue(new Error('wrong type'));
    jwtService.verifyAsync.mockResolvedValue({
      sub: 42,
      sv: 3,
      type: 'refresh',
    });

    await expect(
      service.hasValidAdminSession('refresh-as-access'),
    ).resolves.toBe(false);
    expect(refreshJwt.verifyAsync).not.toHaveBeenCalled();
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('never treats an access token as a refresh token', async () => {
    sessions.verify.mockRejectedValue(new Error('wrong type'));
    refreshJwt.verifyAsync.mockResolvedValue({ sub: 42, sv: 3 });

    await expect(
      service.hasValidAdminSession(undefined, 'access-as-refresh'),
    ).resolves.toBe(false);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it('invalidates both old token types for the preview immediately after logout', async () => {
    const accessPayload = { sub: 42, sv: 3 };
    const refreshPayload = { sub: 42, sv: 3, type: 'refresh' };
    jwtService.verifyAsync.mockResolvedValue(accessPayload);
    refreshJwt.verifyAsync.mockResolvedValue(refreshPayload);
    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.SUPERADMIN,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 3,
    });

    await expect(
      service.hasValidAdminSession('old-access', 'old-refresh'),
    ).resolves.toBe(true);
    await service.logout('old-access', 'old-refresh');

    expect(sessions.revoke).toHaveBeenCalledWith('session-1');
    sessions.verify.mockRejectedValue(new Error('revoked'));

    usersService.findById.mockResolvedValue({
      id: 42,
      role: Role.SUPERADMIN,
      accountState: UserAccountState.ACTIVE,
      sessionVersion: 4,
    });
    await expect(
      service.hasValidAdminSession('old-access', 'old-refresh'),
    ).resolves.toBe(false);
    await expect(
      service.hasValidAdminSession(undefined, 'old-refresh'),
    ).resolves.toBe(false);
  });

  it('hands the account cart and active checkout ownership to a fresh guest session on logout', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 42, sv: 3 });
    tx.cart.findUnique.mockResolvedValue({ id: 9 });

    await expect(
      service.logoutToAnonymousCart(
        'opaque-logout-cart-owner-123456',
        'access-token',
      ),
    ).resolves.toEqual({ cartMoved: true });

    expect(tx.checkoutSnapshot.updateMany).toHaveBeenCalledWith({
      where: { userId: 42, anonymousId: null, cartId: 9 },
      data: { userId: null, anonymousId: 'opaque-logout-cart-owner-123456' },
    });
    expect(tx.cart.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { userId: null, anonymousId: 'opaque-logout-cart-owner-123456' },
    });
    expect(tx.authSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it('keeps production auth cookies Secure despite a stray local-mode flag', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_ENV = 'local';
    const productionService = new AuthService(
      usersService as any,
      jwtService as any,
      refreshJwt as any,
      cartService as any,
      prisma,
      emailService as any,
      newsletterService as any,
      sessions as any,
    );
    const response = { cookie: jest.fn(), setHeader: jest.fn() };

    productionService.setAuthCookies(response as any, {
      accessToken: 'access',
      refreshToken: 'refresh',
    });

    expect(response.cookie).toHaveBeenCalledWith(
      'jwt',
      'access',
      expect.objectContaining({ secure: true }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh',
      expect.objectContaining({ secure: true }),
    );
  });

  it('clears a successfully merged anonymous cart cookie with its original scope', () => {
    const response = { clearCookie: jest.fn() };

    service.clearMergedAnonymousCartCookie(response as any);

    expect(response.clearCookie).toHaveBeenCalledWith(
      'cartId',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/api',
      }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      'cartId',
      expect.objectContaining({ path: '/api/cart' }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      'cartId',
      expect.objectContaining({ path: '/api/cart/items' }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      'cartId',
      expect.objectContaining({ path: '/' }),
    );
  });
});
