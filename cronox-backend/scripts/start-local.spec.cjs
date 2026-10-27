const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildLocalEnvironment } = require('./start-local.cjs');
const local = {
  NODE_ENV:'development', DATABASE_URL:'postgresql://local@127.0.0.1:5433/cronox_dev', DIRECT_URL:'postgresql://local@127.0.0.1:5433/cronox_dev',
  FRONTEND_URL:'http://localhost:3000', API_PUBLIC_URL:'http://localhost:3000', EMAIL_ENABLED:'false',
  BACKGROUND_JOBS_ENABLED:'false', WAITLIST_EMAIL_WORKER_ENABLED:'false', STRIPE_SECRET_KEY:'sk_test_local_disabled',
};
test('local profile wins over inherited deployment environment and blanks credentials before Prisma loads dotenv', () => {
  const result=buildLocalEnvironment(local,{NODE_ENV:'production',DATABASE_URL:'postgresql://remote.example/live',SMTP_HOST:'mail.example',SUPABASE_SERVICE_ROLE_KEY:'private',STRIPE_SECRET_KEY:'sk_live_sensitive',PATH:'system-path'},['SMTP_HOST','SMTP_INFO_PASS']);
  assert.equal(result.DATABASE_URL,local.DATABASE_URL);
  assert.equal(result.NODE_ENV,'development');
  assert.equal(result.SMTP_HOST,''); assert.equal(result.SMTP_INFO_PASS,'');
  assert.equal(result.SUPABASE_SERVICE_ROLE_KEY,'');
  assert.equal(result.STRIPE_SECRET_KEY,'sk_test_local_disabled');
  assert.equal(result.PATH,'system-path');
  assert.equal(result.DOTENV_CONFIG_PATH,result.CRONOX_ENV_FILE);
});
test('rejects a remote database, differing migration target, live key, outgoing email and enabled jobs', () => {
  for (const patch of [{DATABASE_URL:'postgresql://remote.example/live'},{DIRECT_URL:'postgresql://local@127.0.0.1:5433/other'},{STRIPE_SECRET_KEY:'sk_live_sensitive'},{EMAIL_ENABLED:'true'},{BACKGROUND_JOBS_ENABLED:'true'},{SUPABASE_URL:'https://project.supabase.co'},{MAILBOX_WORKER_ENABLED:'true'},{MAILBOX_SEND_ENABLED:'true'}]) {
    assert.throws(()=>buildLocalEnvironment({...local,...patch},{}));
  }
});

test('never inherits Correos credentials or enables carrier jobs from a parent deployment session', () => {
  const result = buildLocalEnvironment(local, { CORREOS_TRACKING_ENABLED:'true', CORREOS_EMAIL_ENABLED:'true', CORREOS_IDENTITY_CLIENT_SECRET:'inert-fixture', CORREOS_DEVELOPERS_CLIENT_SECRET:'inert-fixture' });
  assert.equal(result.CORREOS_TRACKING_ENABLED, ''); assert.equal(result.CORREOS_EMAIL_ENABLED, '');
  assert.equal(result.CORREOS_IDENTITY_CLIENT_SECRET, ''); assert.equal(result.CORREOS_DEVELOPERS_CLIENT_SECRET, '');
});

test('checkout test activation cannot be inherited from the parent shell', () => {
  const result = buildLocalEnvironment(local, { CRONOX_LOCAL_CHECKOUT_TEST: 'true', CHECKOUT_RESERVATION_WORKER_ENABLED: 'true', LOCAL_CHECKOUT_STRIPE_TEST: 'true', STRIPE_WEBHOOK_WORKER_ENABLED: 'true' });
  for (const key of ['CRONOX_LOCAL_CHECKOUT_TEST', 'CHECKOUT_RESERVATION_WORKER_ENABLED', 'LOCAL_CHECKOUT_STRIPE_TEST', 'STRIPE_WEBHOOK_WORKER_ENABLED']) assert.equal(result[key], '');
});
