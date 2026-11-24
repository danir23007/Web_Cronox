import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { encrypt, decrypt } from '../mailbox/mailbox-security';
import { getRequiredJwtSecret } from '../common/config/environment';

// Keep existing campaign links valid. The scoped fallback uses an existing
// required deployment secret, so necessary mail does not require mailbox setup.
function preferenceKey() {
  const secret = process.env.EMAIL_PREFERENCES_SECRET || getRequiredJwtSecret('JWT_ACCESS_SECRET');
  if (secret.length < 32) throw Error('EMAIL_PREFERENCES_SECRET_TOO_SHORT');
  return createHash('sha256').update('cronox-mail-preferences-v1\0' + secret).digest();
}
export function mailPreferenceToken(email: string) {
  try { return Buffer.from(encrypt(email, 'mailbox-campaign-unsubscribe')).toString('base64url'); }
  catch {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', preferenceKey(), iv);
    cipher.setAAD(Buffer.from('cronox-mail-preferences-v1'));
    const encrypted = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
    return 'mp1_' + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  }
}
export function readMailPreferenceToken(token: string) {
  if (!/^[\w-]{1,2000}$/.test(token)) throw Error('INVALID_MAIL_PREFERENCES');
  if (!token.startsWith('mp1_')) return decrypt(Buffer.from(token, 'base64url').toString(), 'mailbox-campaign-unsubscribe');
  const raw = Buffer.from(token.slice(4), 'base64url');
  if (raw.length < 29) throw Error('INVALID_MAIL_PREFERENCES');
  const cipher = createDecipheriv('aes-256-gcm', preferenceKey(), raw.subarray(0, 12));
  cipher.setAAD(Buffer.from('cronox-mail-preferences-v1')); cipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8');
}
