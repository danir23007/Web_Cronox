const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const dotenv = require('dotenv');
const { prepareValues, updateEnvironment, validateDirectory, fixedPrivateKey } = require('./prepare-mailboxes.cjs');
test('VAPID scalars with leading zero bytes keep their key and encode as exactly 32 bytes', () => {
  const curve = crypto.createECDH('prime256v1');
  curve.setPrivateKey(Buffer.from([1]));
  const key = fixedPrivateKey(curve);
  assert.equal(key.length, 43);
  assert.equal(Buffer.from(key, 'base64url').length, 32);
  const prepared = prepareValues({ MAILBOX_VAPID_PRIVATE_KEY: key,
    MAILBOX_VAPID_PUBLIC_KEY: curve.getPublicKey().toString('base64url') }, '/private/mail', 'mailto:operator@example.test', true);
  assert.equal(prepared.MAILBOX_VAPID_PRIVATE_KEY, key);
  assert.equal(prepared.MAILBOX_VAPID_PUBLIC_KEY, curve.getPublicKey().toString('base64url'));
});
test('valid encryption keys and VAPID pair stay stable across repeated preparation', () => {
  const first = prepareValues({}, '/private/mail', 'mailto:operator@example.test', true);
  const second = prepareValues(first, '/ignored', '', true);
  assert.deepEqual(second, first);
  assert.equal(Buffer.from(JSON.parse(first.MAILBOX_ENCRYPTION_KEYS)[first.MAILBOX_ENCRYPTION_KEY_ID], 'base64').length, 32);
  const curve = crypto.createECDH('prime256v1');
  curve.setPrivateKey(Buffer.from(first.MAILBOX_VAPID_PRIVATE_KEY, 'base64url'));
  assert.equal(curve.getPublicKey().toString('base64url'), first.MAILBOX_VAPID_PUBLIC_KEY);
});
test('preserves historical keys and disables both controls without touching SMTP passwords', () => {
  const first = prepareValues({}, '/private/mail', 'mailto:operator@example.test', false);
  const ring = JSON.parse(first.MAILBOX_ENCRYPTION_KEYS);
  ring.old = crypto.randomBytes(32).toString('base64');
  const existing = { ...first, MAILBOX_ENCRYPTION_KEYS: JSON.stringify(ring), MAILBOX_WORKER_ENABLED: 'true', MAILBOX_SEND_ENABLED: 'true' };
  const updated = prepareValues(existing, '/other', '', false);
  assert.equal(updated.MAILBOX_ENCRYPTION_KEYS, existing.MAILBOX_ENCRYPTION_KEYS);
  assert.equal(updated.MAILBOX_WORKER_ENABLED, 'false');
  assert.equal(updated.MAILBOX_SEND_ENABLED, 'false');
  const original = "SMTP_SUPPORT_PASS='synthetic-password-kept'\r\nEMAIL_ENABLED=true\r\n";
  const text = updateEnvironment(original, updated);
  assert.equal(dotenv.parse(text).SMTP_SUPPORT_PASS, 'synthetic-password-kept');
  assert.equal(dotenv.parse(text).EMAIL_ENABLED, 'true');
  assert.equal(updateEnvironment(text, updated), text);
});
test('never replaces missing or inconsistent existing cryptographic material', () => {
  const first = prepareValues({}, '/private/mail', 'mailto:operator@example.test', true);
  for (const patch of [{ MAILBOX_ENCRYPTION_KEYS: '{bad' }, { MAILBOX_ENCRYPTION_KEY_ID: 'absent' },
    { MAILBOX_ENCRYPTION_KEYS: '{"old":"invalid"}' }, { MAILBOX_VAPID_PRIVATE_KEY: '' },
    { MAILBOX_VAPID_PUBLIC_KEY: 'different' }]) {
    assert.throws(() => prepareValues({ ...first, ...patch }, '/private/mail', '', true));
  }
  const missingPublic = prepareValues({ ...first, MAILBOX_VAPID_PUBLIC_KEY: '' }, '/private/mail', '', true);
  assert.equal(missingPublic.MAILBOX_VAPID_PUBLIC_KEY, first.MAILBOX_VAPID_PUBLIC_KEY);
});
test('storage refuses the checkout, public resources and filesystem root', () => {
  assert.throws(() => validateDirectory(path.resolve(__dirname, '..')));
  assert.throws(() => validateDirectory(path.resolve(__dirname, '../../cronox-front')));
  assert.throws(() => validateDirectory(path.parse(path.resolve(__dirname)).root));
  assert.throws(() => validateDirectory('relative/path'));
});
