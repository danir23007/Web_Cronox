import {
  ANONYMOUS_CART_TTL_MS,
  CART_COOKIE_PATH,
  getCartCookieOptions,
} from './cart-cookie';

describe('anonymous cart cookie', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it('stores only an opaque owner handle for exactly 60 minutes', () => {
    process.env.NODE_ENV = 'development';

    expect(ANONYMOUS_CART_TTL_MS).toBe(60 * 60 * 1000);
    expect(getCartCookieOptions()).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: CART_COOKIE_PATH,
      maxAge: 3_600_000,
    });
  });

  it('marks the anonymous owner cookie Secure in production HTTPS', () => {
    process.env.NODE_ENV = 'production';

    expect(getCartCookieOptions()).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: true,
        path: '/api',
        maxAge: 3_600_000,
      }),
    );
  });
});
