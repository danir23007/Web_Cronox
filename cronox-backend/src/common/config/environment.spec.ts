import { validateEnvironment } from './environment';

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
});
