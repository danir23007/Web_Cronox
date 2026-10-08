import { Prisma, User, UserAccountState } from '@prisma/client';
import { normalizeEmail } from '../common/email';
import { getNextSequentialMemberCode } from '../users/member-code.util';

/** Caller owns the newsletter-email transaction lock. Never infer consent. */
export async function linkNewsletterUser(tx: Prisma.TransactionClient, email: string, consent: boolean) {
  const normalized = normalizeEmail(email);
  const matches = await tx.$queryRaw<Pick<User, 'id' | 'email' | 'role' | 'accountState' | 'newsletterSubscribed' | 'firstOrderDiscountUsed' | 'memberCode'>[]>`SELECT id, email, role, "accountState", "newsletterSubscribed", "firstOrderDiscountUsed", "memberCode" FROM "User" WHERE lower(btrim(email)) = ${normalized} LIMIT 2`;
  if (matches.length > 1) throw new Error('Ambiguous newsletter account: manual review required');
  let user = matches[0];
  if (!user) {
    user = await tx.user.create({ data: {
      email: normalized, password: null, accountState: UserAccountState.PRE_REGISTERED,
      memberCode: await getNextSequentialMemberCode(tx), newsletterSubscribed: consent,
    } });
  } else if (consent && !user.newsletterSubscribed) {
    user = await tx.user.update({ where: { id: user.id }, data: { newsletterSubscribed: true } });
  }
  return user;
}
