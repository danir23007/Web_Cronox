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
    };
    controller = new AuthController(authService);
    response = {};
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
  });
});
