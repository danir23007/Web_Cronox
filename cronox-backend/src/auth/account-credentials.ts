import { Prisma } from '@prisma/client';
import { normalizeEmail } from '../common/email';

/** One lock order for issuing, consuming and revoking account capabilities. */
export async function lockAccountCredentials(tx: Prisma.TransactionClient, userId: number) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cronox:account-credentials:' + userId}))`;
}

/** Caller holds the account lock and changes credentials in this transaction. */
export async function revokeAccountLinks(tx: Prisma.TransactionClient, userId: number, email: string, now = new Date()) {
  await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  await tx.newsletterMailJob.updateMany({
    where: { userId, kind: 'ACCESS', tokenUsedAt: null }, data: { tokenUsedAt: now },
  });
  // Before dispatch, ACCESS jobs have only an email. A request queued before
  // this change must not mint a fresh capability after revocation completes.
  await tx.newsletterMailJob.updateMany({
    where: { email: normalizeEmail(email), kind: 'ACCESS', userId: null, status: { in: ['QUEUED', 'PROCESSING'] } },
    data: { status: 'FAILED', errorCode: 'CREDENTIALS_CHANGED', tokenUsedAt: now, claimToken: null, claimedAt: null },
  });
  await tx.preRegistration.updateMany({
    where: { userId, launchTokenUsedAt: null }, data: { launchTokenUsedAt: now },
  });
}
