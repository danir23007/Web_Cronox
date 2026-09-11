import {
  CRONOX_PRODUCTION_ORIGINS,
  getCorsOrigins,
  isCorsOriginAllowed,
  normalizeCorsOrigin,
  validateEnvironment,
} from './environment';

const validEnvironment = () => ({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://cronox:password@localhost:5432/cronox',
  JWT_ACCESS_SECRET: 'access-secret-with-at-least-thirty-two-characters',
  JWT_REFRESH_SECRET: 'refresh-secret-with-at-least-thirty-two-characters',
  STRIPE_SECRET_KEY: 'sk_test_not_a_real_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_not_a_real_secret',
  FRONTEND_URL: 'http://localhost:3000',
});

describe('validateEnvironment', () => {
  it('accepts a complete, non-production security contract', () => {
    expect(() => validateEnvironment(validEnvironment())).not.toThrow();
  });

  it('fails closed when a JWT secret is absent', () => {
    const config = validEnvironment();
    delete config.JWT_ACCESS_SECRET;

    expect(() => validateEnvironment(config)).toThrow('JWT_ACCESS_SECRET');
  });

  it('rejects equal JWT secrets and placeholder values', () => {
    const matching = validEnvironment();
    matching.JWT_REFRESH_SECRET = matching.JWT_ACCESS_SECRET;
    expect(() => validateEnvironment(matching)).toThrow('must be different');

    const placeholder = validEnvironment();
    placeholder.JWT_ACCESS_SECRET =
      'replace_with_a_real_random_secret_of_32_chars';
    expect(() => validateEnvironment(placeholder)).toThrow('non-placeholder');
  });

  it('requires HTTPS public URLs in production', () => {
    const config = validEnvironment();
    config.NODE_ENV = 'production';
    config.STRIPE_SECRET_KEY = 'sk_live_not_a_real_key';

    expect(() => validateEnvironment(config)).toThrow('https');
  });

  it('requires a live Stripe secret key in production', () => {
    const config = validEnvironment();
    config.NODE_ENV = 'production';
    config.FRONTEND_URL = 'https://cronox.example';

    expect(() => validateEnvironment(config)).toThrow('live Stripe');
  });

  it('normalizes origins by exact scheme, hostname and port', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(normalizeCorsOrigin('https://cronox.es/')).toBe(
        'https://cronox.es',
      );
      expect(
        isCorsOriginAllowed(
          'https://cronox.es:443/',
          CRONOX_PRODUCTION_ORIGINS.slice(),
        ),
      ).toBe(true);
      for (const origin of [
        'http://cronox.es',
        'https://shop.cronox.es',
        'https://cronox.es.evil.example',
        'https://cronox.es:444',
      ]) {
        expect(
          isCorsOriginAllowed(origin, CRONOX_PRODUCTION_ORIGINS.slice()),
        ).toBe(false);
      }
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('always includes both official HTTPS origins', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalFrontendUrl = process.env.FRONTEND_URL;
    const originalCorsOrigins = process.env.CORS_ORIGINS;
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_URL = 'https://cronox.es';
    process.env.CORS_ORIGINS = 'https://cronox.es';
    try {
      expect(getCorsOrigins()).toEqual(
        expect.arrayContaining(['https://cronox.es', 'https://www.cronox.es']),
      );
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
      if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
      else process.env.FRONTEND_URL = originalFrontendUrl;
      if (originalCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = originalCorsOrigins;
    }
  });

  it('rejects paths, credentials and HTTP production CORS entries', () => {
    const production = validEnvironment();
    production.NODE_ENV = 'production';
    production.FRONTEND_URL = 'https://cronox.es';
    production.STRIPE_SECRET_KEY = 'sk_live_not_a_real_key';

    for (const origin of [
      'https://cronox.es/path',
      'https://user:pass@cronox.es',
      'http://cronox.es',
    ]) {
      expect(() =>
        validateEnvironment({ ...production, CORS_ORIGINS: origin }),
      ).toThrow();
    }
  });
});
