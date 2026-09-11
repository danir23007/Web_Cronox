import type { ExecutionContext } from '@nestjs/common';
import { CsrfProtectionGuard } from './csrf-protection.guard';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CORS_ORIGINS = process.env.CORS_ORIGINS;

const contextFor = (overrides: Record<string, unknown> = {}) => {
  const headers =
    (overrides.headers as Record<string, string> | undefined) ?? {};
  const request = {
    method: 'POST',
    originalUrl: '/api/key-screen/preregister',
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

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ORIGINS = 'https://cronox.es,https://www.cronox.es';
  });

  afterAll(() => {
    if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    if (ORIGINAL_CORS_ORIGINS === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = ORIGINAL_CORS_ORIGINS;
  });

  it.each(['https://cronox.es', 'https://www.cronox.es'])(
    'accepts preregistration from %s with a matching double-submit token',
    (origin) => {
      const token = 'a-token-with-sufficient-length-to-compare';
      expect(
        guard.canActivate(
          contextFor({
            headers: {
              origin,
              'x-csrf-token': token,
            },
          }),
        ),
      ).toBe(true);
    },
  );

  it('normalizes a trusted origin without broadening the hostname', () => {
    const token = 'a-token-with-sufficient-length-to-compare';
    expect(
      guard.canActivate(
        contextFor({
          headers: {
            origin: 'https://cronox.es/',
            'x-csrf-token': token,
          },
        }),
      ),
    ).toBe(true);
  });

  it('rejects a missing or mismatched CSRF header', () => {
    expect(() =>
      guard.canActivate(
        contextFor({ headers: { origin: 'https://cronox.es' } }),
      ),
    ).toThrow('CSRF');

    expect(() =>
      guard.canActivate(
        contextFor({
          headers: {
            origin: 'https://cronox.es',
            'x-csrf-token': 'not-the-cookie-token',
          },
        }),
      ),
    ).toThrow('CSRF');
  });

  it('rejects an unknown, deceptive, downgraded or unexpected-port origin', () => {
    const token = 'a-token-with-sufficient-length-to-compare';
    for (const origin of [
      'https://cronox.es.evil.example',
      'https://shop.cronox.es',
      'http://cronox.es',
      'https://cronox.es:444',
    ]) {
      expect(() =>
        guard.canActivate(
          contextFor({
            headers: { origin, 'x-csrf-token': token },
          }),
        ),
      ).toThrow('Origen');
    }
  });

  it('accepts a trusted Referer when Origin is absent and rejects both missing', () => {
    const token = 'a-token-with-sufficient-length-to-compare';
    expect(
      guard.canActivate(
        contextFor({
          headers: {
            referer: 'https://www.cronox.es/privacidad',
            'x-csrf-token': token,
          },
        }),
      ),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextFor({ headers: { 'x-csrf-token': token } })),
    ).toThrow('Origen');
  });

  it('keeps explicit localhost origins available in development', () => {
    process.env.NODE_ENV = 'development';
    process.env.CORS_ORIGINS = 'https://cronox.es';
    const token = 'a-token-with-sufficient-length-to-compare';
    expect(
      guard.canActivate(
        contextFor({
          headers: {
            origin: 'http://localhost:3000',
            'x-csrf-token': token,
          },
        }),
      ),
    ).toBe(true);
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
