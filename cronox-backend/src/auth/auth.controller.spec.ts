import { AuthController } from './auth.controller';

describe('AuthController cart merge cookie lifecycle', () => {
  const loginResult = {
    user: { id: 42 },
    tokens: { accessToken: 'access', refreshToken: 'refresh' },
  };
  let authService: any;
  let controller: AuthController;
  let response: any;

  beforeEach(() => {
    authService = {
      login: jest.fn().mockResolvedValue(loginResult),
      register: jest.fn().mockResolvedValue(loginResult),
      mergeCartOnLogin: jest.fn(),
      logCartMergeResult: jest.fn(),
      logCartMergeError: jest.fn(),
      setAuthCookies: jest.fn(),
      clearMergedAnonymousCartCookie: jest.fn(),
      recordSuccessfulLogin: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(loginResult),
      reportClientVisit: jest.fn().mockResolvedValue(null),
      logoutToAnonymousCart: jest.fn().mockResolvedValue({ cartMoved: false }),
      clearAuthCookies: jest.fn(),
    };
    controller = new AuthController(authService);
    response = {};
  });

  it.each(['internal', 'bot', 'missing marker'])(
    'does not renew %s traffic',
    async (kind) => {
      const headers: Record<string, string> = {
        'X-Cronox-Client-Visit': 'visible',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
        'User-Agent': 'Mozilla/5.0',
      };
      if (kind === 'internal') delete headers['Sec-Fetch-Site'];
      if (kind === 'bot') headers['User-Agent'] = 'Mozilla/5.0 Googlebot';
      if (kind === 'missing marker') delete headers['X-Cronox-Client-Visit'];
      expect(
        await controller.visit(
          { get: (key: string) => headers[key] } as any,
          response,
        ),
      ).toEqual({ renewed: false });
      expect(authService.reportClientVisit).not.toHaveBeenCalled();
    },
  );

  it('returns success and persistent cookies only after an authenticated browser visit is persisted', async () => {
    const tokens = {
      ...loginResult.tokens,
      refreshExpiresAt: new Date('2028-01-01'),
    };
    authService.reportClientVisit.mockResolvedValue(tokens);
    const headers: Record<string, string> = {
      'X-Cronox-Client-Visit': 'visible',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-Fetch-Mode': 'cors',
      'User-Agent': 'Mozilla/5.0',
    };
    const claims = { sid: 'session', sub: 42, sv: 1 };
    expect(
      await controller.visit(
        { get: (key: string) => headers[key], authSession: claims } as any,
        response,
      ),
    ).toEqual({
      renewed: true,
      expiresAt: tokens.refreshExpiresAt.toISOString(),
    });
    expect(authService.reportClientVisit).toHaveBeenCalledWith(claims);
    expect(authService.setAuthCookies).toHaveBeenCalledWith(response, tokens);
  });

  it('preserves cookies when logout cannot confirm database revocation', async () => {
    authService.logoutToAnonymousCart.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(
      controller.logout({ cookies: {} } as any, response),
    ).rejects.toThrow('database unavailable');
    expect(authService.clearAuthCookies).not.toHaveBeenCalled();
  });

  it('clears cartId only after the guest cart merge succeeds', async () => {
    authService.mergeCartOnLogin.mockResolvedValue({
      merged: true,
      incidents: [],
    });

    await controller.login(
      { cookies: { cartId: 'recoverable-guest-cart' } } as any,
      response,
      { email: 'member@example.test', password: 'ValidPassword1' },
    );

    expect(authService.mergeCartOnLogin).toHaveBeenCalledWith(
      42,
      'recoverable-guest-cart',
    );
    expect(authService.clearMergedAnonymousCartCookie).toHaveBeenCalledWith(
      response,
    );
    expect(authService.recordSuccessfulLogin).toHaveBeenCalledTimes(1);
  });

  it('preserves cartId when merge fails so an explicit later login can recover it', async () => {
    authService.mergeCartOnLogin.mockRejectedValue(new Error('database down'));

    await controller.login(
      { cookies: { cartId: 'recoverable-guest-cart' } } as any,
      response,
      { email: 'member@example.test', password: 'ValidPassword1' },
    );

    expect(authService.logCartMergeError).toHaveBeenCalled();
    expect(authService.clearMergedAnonymousCartCookie).not.toHaveBeenCalled();
    expect(authService.setAuthCookies).toHaveBeenCalled();
    expect(authService.recordSuccessfulLogin).toHaveBeenCalledTimes(1);
  });

  it('also merges and clears the guest cookie after successful registration', async () => {
    authService.mergeCartOnLogin.mockResolvedValue({
      merged: true,
      incidents: [],
    });

    await controller.register(
      { cookies: { cartId: 'registration-guest-cart' } } as any,
      response,
      {
        email: 'new-member@example.test',
        password: 'ValidPassword1',
        firstName: 'New',
        lastName: 'Member',
      },
    );

    expect(authService.mergeCartOnLogin).toHaveBeenCalledWith(
      42,
      'registration-guest-cart',
    );
    expect(authService.clearMergedAnonymousCartCookie).toHaveBeenCalledWith(
      response,
    );
    expect(authService.recordSuccessfulLogin).not.toHaveBeenCalled();
  });

  it('does not record failed authentication or refresh as a successful login', async () => {
    authService.login.mockRejectedValueOnce(new Error('invalid credentials'));
    await expect(
      controller.login({ cookies: {} } as any, response, {
        email: 'member@example.test',
        password: 'wrong-password',
      }),
    ).rejects.toThrow('invalid credentials');
    await controller.refresh({ user: { id: 42 } } as any, response);

    expect(authService.recordSuccessfulLogin).not.toHaveBeenCalled();
  });
});
