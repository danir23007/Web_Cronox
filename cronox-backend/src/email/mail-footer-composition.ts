import { getFrontendUrl, getPublicApiUrl } from '../common/config/environment';
import { FOOTER_DEFAULTS } from '../footer/footer-settings.service';
import { composeGlobalMailFooter, COMMERCIAL_MAIL_PURPOSES } from './mail-global-footer';
import { mailPreferenceToken } from './mail-preference-token';

export async function assertCommercialMailAllowed(db: any, purpose: string | undefined | null, recipients: string[]) {
  if (!COMMERCIAL_MAIL_PURPOSES.has(purpose || '')) return;
  for (const email of recipients) {
    if (await db?.mailboxSuppression?.findUnique({ where: { email: email.trim().toLowerCase() } }))
      throw Object.assign(Error('COMMERCIAL_MAIL_SUPPRESSED'), { deliverySuppressed: true });
  }
}

/** Shared by previews, automatic MIME, mailbox MIME and frozen campaign MIME.
 * It never writes a draft, version, publication or recipient preference. */
export async function composeApplicationMail(db: any, content: { html?: unknown; text?: unknown }, context: {
  purpose?: string | null; recipients?: string[]; preview?: boolean;
}) {
  let socials = FOOTER_DEFAULTS;
  try {
    const record = await db?.footerSettings?.findUnique({ where: { id: 'global' } });
    if (record) socials = { ...FOOTER_DEFAULTS, ...record };
  } catch { /* Brand defaults are safe; never block necessary mail on cosmetic settings. */ }
  const recipients = [...new Set(context.recipients || [])];
  const preferenceUrl = !context.preview && recipients.length === 1
    ? new URL('/api/mailbox-unsubscribe/' + mailPreferenceToken(recipients[0].trim().toLowerCase()), getPublicApiUrl()).href
    : new URL('/preferencias-correo', getFrontendUrl()).href;
  return composeGlobalMailFooter(typeof content.html === 'string' ? content.html : '',
    typeof content.text === 'string' ? content.text : '', { purpose: context.purpose, preferenceUrl, socials, assetOrigin: getFrontendUrl() });
}
