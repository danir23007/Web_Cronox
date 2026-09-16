'use strict';

// Deliberately fake, deterministic values for tests that bootstrap real Nest
// modules. None of these values is valid for a deployed CRONOX environment.
const TEST_ENVIRONMENT = Object.freeze({
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://ci_export_test:ci_export_test@127.0.0.1:1/cronox_ci_export_test',
  JWT_ACCESS_SECRET:
    'ci-only-access-jwt-value-7f21a9c4b6038d52',
  JWT_REFRESH_SECRET:
    'ci-only-refresh-jwt-value-91e6c2a8475b3d08',
  STRIPE_SECRET_KEY: 'sk_test_ci_only_not_a_real_stripe_key',
  STRIPE_WEBHOOK_SECRET: 'whsec_ci_only_not_a_real_webhook_secret',
  FRONTEND_URL: 'http://127.0.0.1:43119',
  API_PUBLIC_URL: 'http://127.0.0.1:43119',
  CORS_ORIGINS: 'http://127.0.0.1:43119',
  EMAIL_ENABLED: 'false',
  ENABLE_SWAGGER: 'false',
});

const TEST_ENVIRONMENT_KEYS = Object.freeze(Object.keys(TEST_ENVIRONMENT));

const withTestEnvironment = (baseEnvironment = {}, options = {}) => {
  const environment = { ...baseEnvironment };
  const force = options.force === true;
  for (const [key, value] of Object.entries(TEST_ENVIRONMENT)) {
    if (force || !environment[key]) environment[key] = value;
  }
  return { ...environment, ...(options.overrides || {}) };
};

const installTestEnvironment = (options = {}) => {
  const previous = new Map(
    TEST_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, withTestEnvironment(process.env, options));
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
};

module.exports = {
  TEST_ENVIRONMENT,
  TEST_ENVIRONMENT_KEYS,
  installTestEnvironment,
  withTestEnvironment,
};
