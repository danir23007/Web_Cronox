type EnvironmentSource = Record<string, string | undefined>;

const JWT_SECRET_MIN_LENGTH = 32;
const PLACEHOLDER_SECRET_PATTERN =
  /^(?:change|replace|your|example|test|secret)(?:[_-]|$)/i;

const read = (source: EnvironmentSource, name: string): string | undefined => {
  const value = source[name]?.trim();
  return value || undefined;
};

const requireValue = (source: EnvironmentSource, name: string): string => {
  const value = read(source, name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const ensureAbsoluteUrl = (
  name: string,
  value: string,
  production: boolean,
): void => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute http(s) URL`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }

  if (production && url.protocol !== 'https:') {
    throw new Error(`${name} must use https in production`);
  }
};

const ensureDatabaseUrl = (value: string): void => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL connection URL');
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new Error(
      'DATABASE_URL must use the postgres or postgresql protocol',
    );
  }
};

const ensureJwtSecret = (name: string, value: string): void => {
  if (
    value.length < JWT_SECRET_MIN_LENGTH ||
    PLACEHOLDER_SECRET_PATTERN.test(value)
  ) {
    throw new Error(
      `${name} must be a unique, non-placeholder secret of at least ${JWT_SECRET_MIN_LENGTH} characters`,
    );
  }
};

const parseInteger = (
  name: string,
  value: string | undefined,
  minimum: number,
  fallback: number,
) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}`,
    );
  }

  return parsed;
};

/**
 * ConfigModule calls this before the application starts. Keep the contract here
 * instead of silently substituting security-sensitive defaults in consumers.
 */
export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const source = config as EnvironmentSource;
  const nodeEnv = read(source, 'NODE_ENV') ?? 'development';
  const production = nodeEnv === 'production';
  const databaseUrl = requireValue(source, 'DATABASE_URL');
  const accessSecret = requireValue(source, 'JWT_ACCESS_SECRET');
  const refreshSecret = requireValue(source, 'JWT_REFRESH_SECRET');
  const stripeSecret = requireValue(source, 'STRIPE_SECRET_KEY');
  const webhookSecret = requireValue(source, 'STRIPE_WEBHOOK_SECRET');
  const frontendUrl = requireValue(source, 'FRONTEND_URL');

  ensureDatabaseUrl(databaseUrl);
  ensureJwtSecret('JWT_ACCESS_SECRET', accessSecret);
  ensureJwtSecret('JWT_REFRESH_SECRET', refreshSecret);

  if (accessSecret === refreshSecret) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values',
    );
  }

  if (!stripeSecret.startsWith(production ? 'sk_live_' : 'sk_')) {
    throw new Error(
      production
        ? 'STRIPE_SECRET_KEY must be a live Stripe secret key in production'
        : 'STRIPE_SECRET_KEY must be a Stripe secret key',
    );
  }

  if (!webhookSecret.startsWith('whsec_')) {
    throw new Error(
      'STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret',
    );
  }

  ensureAbsoluteUrl('FRONTEND_URL', frontendUrl, production);

  const apiPublicUrl = read(source, 'API_PUBLIC_URL');
  if (apiPublicUrl) {
    ensureAbsoluteUrl('API_PUBLIC_URL', apiPublicUrl, production);
  }

  parseInteger(
    'BCRYPT_SALT_ROUNDS',
    read(source, 'BCRYPT_SALT_ROUNDS'),
    10,
    12,
  );
  parseInteger(
    'RATE_LIMIT_TTL_MS',
    read(source, 'RATE_LIMIT_TTL_MS'),
    1_000,
    60_000,
  );
  parseInteger('RATE_LIMIT_MAX', read(source, 'RATE_LIMIT_MAX'), 1, 100);
  parseInteger('TRUST_PROXY_HOPS', read(source, 'TRUST_PROXY_HOPS'), 0, 0);

  return config;
}

export function getRequiredEnvironmentValue(name: string): string {
  return requireValue(process.env, name);
}

export function getRequiredJwtSecret(
  name: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET',
): string {
  const value = getRequiredEnvironmentValue(name);
  ensureJwtSecret(name, value);
  return value;
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getBcryptSaltRounds(): number {
  return parseInteger(
    'BCRYPT_SALT_ROUNDS',
    read(process.env, 'BCRYPT_SALT_ROUNDS'),
    10,
    12,
  );
}

export function getRateLimitTtlMs(): number {
  return parseInteger(
    'RATE_LIMIT_TTL_MS',
    read(process.env, 'RATE_LIMIT_TTL_MS'),
    1_000,
    60_000,
  );
}

export function getRateLimitMax(): number {
  return parseInteger(
    'RATE_LIMIT_MAX',
    read(process.env, 'RATE_LIMIT_MAX'),
    1,
    100,
  );
}

export function getTrustedProxyHops(): number {
  return parseInteger(
    'TRUST_PROXY_HOPS',
    read(process.env, 'TRUST_PROXY_HOPS'),
    0,
    0,
  );
}

export function getFrontendUrl(): string {
  const value = getRequiredEnvironmentValue('FRONTEND_URL');
  ensureAbsoluteUrl('FRONTEND_URL', value, isProductionEnvironment());
  return value.replace(/\/$/, '');
}

export function getPublicApiUrl(): string {
  const value = read(process.env, 'API_PUBLIC_URL') ?? getFrontendUrl();
  ensureAbsoluteUrl('API_PUBLIC_URL', value, isProductionEnvironment());
  return value.replace(/\/$/, '');
}

export function getCorsOrigins(): string[] {
  const configured = read(process.env, 'CORS_ORIGINS');
  const candidates = configured
    ? configured
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
    : [getFrontendUrl()];

  if (!isProductionEnvironment()) {
    candidates.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }

  const origins = new Set<string>();
  for (const candidate of candidates) {
    ensureAbsoluteUrl('CORS_ORIGINS', candidate, isProductionEnvironment());
    origins.add(new URL(candidate).origin);
  }

  return [...origins];
}
