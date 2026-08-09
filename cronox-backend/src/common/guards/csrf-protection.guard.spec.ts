import type { ExecutionContext } from '@nestjs/common';
import { CsrfProtectionGuard } from './csrf-protection.guard';

jest.mock('../config/environment', () => ({
  getCorsOrigins: () => ['https://store.example.test'],
}));

const contextFor = (overrides: Record<string, unknown> = {}) => {
  const headers =
    (overrides.headers as Record<string, string> | undefined) ?? {};
  const request = {
    method: 'POST',
    originalUrl: '/api/cart/items',
    cookies: { cronox_csrf_token: 'a-token-with-sufficient-length-to-compare' },
    get: (name: string) => headers[name.toLowerCase()],
    ...overrides,
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('CsrfProtectionGuard', () => {
  const guard = new CsrfProtectionGuard();

  it('accepts a trusted origin with a matching double-submit token', () => {
    const token = 'a-token-with-sufficient-length-to-compare';
    expect(
      guard.canActivate(
        contextFor({
          headers: {
            origin: 'https://store.example.test',
            'x-csrf-token': token,
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a missing or mismatched CSRF header', () => {
    expect(() =>
      guard.canActivate(
        contextFor({ headers: { origin: 'https://store.example.test' } }),
      ),
    ).toThrow('CSRF');

    expect(() =>
      guard.canActivate(
        contextFor({
          headers: {
            origin: 'https://store.example.test',
            'x-csrf-token': 'not-the-cookie-token',
          },
        }),
      ),
    ).toThrow('CSRF');
  });

  it('keeps only Stripe signed webhook routes exempt, including a trailing slash', () => {
    expect(
      guard.canActivate(
        contextFor({ originalUrl: '/api/webhooks/stripe/', headers: {} }),
      ),
    ).toBe(true);

    expect(() => guard.canActivate(contextFor({ headers: {} }))).toThrow(
      'Origen',
    );
  });
});
