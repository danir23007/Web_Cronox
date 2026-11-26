import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { normalizeEmail } from '../common/email';

export const preferenceKey = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex');

/** Historical acceptance never overrides a later refusal. */
export async function newsletterVeto(tx: Prisma.TransactionClient, email: string) {
  const normalized = normalizeEmail(email);
  if (await tx.mailboxSuppression.findUnique({ where: { email: normalized } })) return true;
  const last = await tx.auditLog.findFirst({ where: { targetType: 'NEWSLETTER_PREFERENCE', targetId: preferenceKey(normalized) }, orderBy: { id: 'desc' } });
  return (last?.metadata as any)?.subscribed === false;
}

/** Explicit choices only; omitted legacy fields must never call this. */
export async function saveNewsletterPreference(tx: Prisma.TransactionClient, email: string, subscribed: boolean, source: string, userId?: number) {
  email = normalizeEmail(email);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + email}))`;
  if (subscribed && await newsletterVeto(tx, email)) return false;
  if (!subscribed) await tx.mailboxSuppression.upsert({ where: { email }, create: { email, reason: 'DECLINED' }, update: {} });
  if (subscribed) {
    const existing = await tx.newsletterSubscription.findUnique({ where: { email } });
    await tx.newsletterSubscription.upsert({ where: { email }, create: { email, userId, subscribedAt: new Date() }, update: { ...(userId ? { userId } : {}), subscribedAt: existing?.subscribedAt ?? new Date() } });
  }
  if (userId) await tx.user.update({ where: { id: userId }, data: { newsletterSubscribed: subscribed } });
  await tx.auditLog.create({ data: { action: 'NEWSLETTER_PREFERENCE_RECORDED', targetType: 'NEWSLETTER_PREFERENCE', targetId: preferenceKey(email), reason: source, metadata: { subscribed, explicit: true, version: 1, userId: userId ?? null } } });
  return subscribed;
}
