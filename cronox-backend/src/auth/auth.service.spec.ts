import { createHash } from 'crypto';
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
  };
  const newsletterService = { subscribeIfNeeded: jest.fn() };

  let tx: any;
  let prisma: any;
  let service: AuthService;

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_URL = 'http://localhost:3000';
    process.env.BCRYPT_SALT_ROUNDS = '10';

    tx = {
      passwordResetToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
      user: {
        update: jest.fn().mockResolvedValue({ id: 42 }),
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

  it('revokes a validated access session during idempotent logout', async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: 42, sv: 3 });

    await expect(
      service.logout('access-token', undefined),
    ).resolves.toBeUndefined();

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 42, sessionVersion: 3 },
      data: { sessionVersion: { increment: 1 } },
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
    );
    const response = { cookie: jest.fn() };

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
