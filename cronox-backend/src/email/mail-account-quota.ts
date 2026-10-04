import { randomUUID } from 'node:crypto';
import { loadEmailConfig } from './email.config';
import { EmailSenderKey } from './email.types';

export class EmailQuotaWaitError extends Error {
  readonly code = 'EMAIL_RATE_LIMIT';
  readonly quotaWaiting = true;
  constructor(readonly retryAt: Date) { super('EMAIL_QUOTA_WAITING'); }
}
export const quotaWaiting = (error: any): error is EmailQuotaWaitError =>
  error?.quotaWaiting === true && error.retryAt instanceof Date;

const positive = (name: string, fallback: number, optional = false) => {
  const raw = process.env[name];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < (optional ? 0 : 1)) throw Error('EMAIL_CONFIG');
  return value;
};
export function accountQuota(account: string) {
  account = account.trim().toLowerCase();
  if (!account || account.length > 320) throw Error('EMAIL_CONFIG');
  const matches = Object.values(EmailSenderKey).filter(key =>
    loadEmailConfig().accounts[key].user.trim().toLowerCase() === account);
  // Aliases of the same authenticated account share the lowest configured cap.
  const daily = matches.length ? Math.min(...matches.map(key => positive(`SMTP_${key}_DAILY_LIMIT`, 1000))) : 1000;
  const hours = matches.map(key => positive(`SMTP_${key}_HOURLY_LIMIT`, 0, true)).filter(Boolean);
  return { account, keys: matches, daily, hourly: hours.length ? Math.min(...hours) : 0 };
}
export function recipientUnits(options: { to?: unknown; cc?: unknown; bcc?: unknown }) {
  const parse = require('nodemailer/lib/addressparser');
  const emails = new Set<string>();
  const visit = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value === 'object') {
      if (value.group) visit(value.group);
      else if (value.address) emails.add(String(value.address).trim().toLowerCase());
      return;
    }
    parse(String(value)).forEach(visit);
  };
  visit(options.to); visit(options.cc); visit(options.bcc);
  if (!emails.size || emails.size > Math.min(100, positive('MAILBOX_MAX_RECIPIENTS', 100))) throw Error('EMAIL_RECIPIENT_LIMIT');
  return { units: emails.size, recipients: [...emails] };
}

// Call inside the SAME transaction as claiming the source/auditing the attempt.
// Reservations are never refunded for rejection or uncertainty, nor cascaded
// away with drafts/content. No connection is made to SMTP under the DB lock.
export async function reserveAccountQuota(tx: any, account: string, id: string, units: number,
  additional?: { daily: number; hourly: number }) {
  if (process.env.EMAIL_SMTP_PAUSED === 'true') throw new EmailQuotaWaitError(new Date(Date.now()+60000));
  const policy = accountQuota(account);
  const daily = Math.min(policy.daily, additional?.daily || policy.daily);
  const hours = [policy.hourly, additional?.hourly || 0].filter(Boolean);
  const hourly = hours.length ? Math.min(...hours) : 0;
  if (!Number.isSafeInteger(units) || units < 1 || units > daily || (hourly && units > hourly)) throw Error('EMAIL_CONFIG');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-account-budget:${policy.account}`}))`;
  const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
  const since = new Date(now.getTime() - 86400000);
  // Catch old-version attempts concurrent with the additive migration. Also
  // covers configured accounts differing from the migration's known defaults.
  if (policy.keys.length) await tx.$executeRaw`
    INSERT INTO "MailAccountQuota" (id,account,units,"reservedAt")
    SELECT 'AUTO:'||id,${policy.account},"quotaUnits","createdAt" FROM "EmailDelivery"
    WHERE "senderKey"=ANY(${policy.keys}::text[]) AND "createdAt">${since}
      AND status IN ('PENDING','SMTP_ACCEPTED','FAILED','UNKNOWN')
    ON CONFLICT (id) DO NOTHING`;
  await tx.$executeRaw`
    INSERT INTO "MailAccountQuota" (id,account,units,"reservedAt")
    SELECT 'MANUAL:'||s.id,${policy.account},GREATEST(s."quotaUnits",cardinality(s.accepted)+cardinality(s.rejected),
      COALESCE(array_length(regexp_split_to_array(trim(both ',' from concat_ws(',',NULLIF(d."to",''),NULLIF(d.cc,''),NULLIF(d.bcc,''))),','),1),1)),s."startedAt"
    FROM "MailboxSend" s JOIN "MailboxDraft" d ON d.id=s."draftId" JOIN "Mailbox" b ON b.id=d."mailboxId"
    WHERE lower(trim(b.username))=${policy.account} AND s."startedAt">${since}
    ON CONFLICT (id) DO NOTHING`;
  await tx.$executeRaw`
    INSERT INTO "MailAccountQuota" (id,account,units,"reservedAt")
    SELECT 'CAMPAIGN:'||s.id,${policy.account},GREATEST(1,s.attempts),s."startedAt" FROM "MailboxCampaignDelivery" s
    JOIN "MailboxCampaign" c ON c.id=s."campaignId" JOIN "MailboxDraft" d ON d.id=c."draftId" JOIN "Mailbox" b ON b.id=d."mailboxId"
    WHERE lower(trim(b.username))=${policy.account} AND s."startedAt">${since}
    ON CONFLICT (id) DO NOTHING`;
  const previous = await tx.mailAccountQuota.findUnique({ where: { id } });
  if (previous) {
    if (previous.account !== policy.account || previous.units !== units) throw Error('EMAIL_QUOTA_RESERVATION_MISMATCH');
    return;
  }
  const rows = await tx.mailAccountQuota.findMany({ where: { account: policy.account, reservedAt: { gt: since } }, orderBy: { reservedAt: 'asc' } });
  const wait = (window: number, limit: number) => {
    if (!limit) return 0;
    const active = rows.filter((row: any) => row.reservedAt.getTime() > now.getTime() - window);
    let excess = active.reduce((sum: number, row: any) => sum + row.units, units) - limit;
    if (excess <= 0) return 0;
    for (const row of active) {
      excess -= row.units;
      if (excess <= 0) return row.reservedAt.getTime() + window + 1;
    }
    throw Error('EMAIL_QUOTA_ACCOUNTING');
  };
  const retry = Math.max(wait(86400000, daily), wait(3600000, hourly));
  if (retry) throw new EmailQuotaWaitError(new Date(retry));
  await tx.mailAccountQuota.create({ data: { id, account: policy.account, units, reservedAt: now } });
}
export const quotaAttemptId = () => randomUUID();
