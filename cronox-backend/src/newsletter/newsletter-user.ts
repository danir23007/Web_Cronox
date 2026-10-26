import { Prisma, User } from '@prisma/client';
import { normalizeEmail } from '../common/email';
import { ensureAccountWelcome } from '../users/account-welcome';

/** Caller owns the newsletter-email lock. Link existing accounts only. */
export async function linkNewsletterUser(tx: Prisma.TransactionClient, email: string, consent: boolean) {
  const normalized = normalizeEmail(email);
  const matches = await tx.$queryRaw<Pick<User, 'id' | 'email' | 'role' | 'accountState' | 'newsletterSubscribed' | 'firstOrderDiscountUsed' | 'memberCode'>[]>`SELECT id, email, role, "accountState", "newsletterSubscribed", "firstOrderDiscountUsed", "memberCode" FROM "User" WHERE lower(btrim(email)) = ${normalized} LIMIT 2`;
  if (matches.length > 1) throw new Error('Ambiguous newsletter account: manual review required');
  let user = matches[0];
  if (!user) return { user: null };
  if (consent && !user.newsletterSubscribed) {
    user = await tx.user.update({ where: { id: user.id }, data: { newsletterSubscribed: true } });
  }
  return { user: await ensureAccountWelcome(tx, user.id) };
}
