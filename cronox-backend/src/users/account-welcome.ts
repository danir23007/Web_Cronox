import { Prisma } from '@prisma/client';
import { normalizeEmail } from '../common/email';
import { generateDiscountCode } from '../common/discount-code';

/** Runs inside the account lifecycle transaction. Never backfills delivery. */
export async function ensureAccountWelcome(
  tx: Prisma.TransactionClient,
  userId: number,
  newlyCreated = false,
) {
  const account = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const email = normalizeEmail(account.email);
  // Same lock as newsletter opt-in: registration and opt-in share one benefit.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'newsletter:' + email}))`;
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
  const subscription = await tx.newsletterSubscription.findUnique({
    where: { email },
    include: { welcomePromoCode: true },
  });
  const legacy = user.firstOrderDiscountCode
    ? await tx.discountCode.findUnique({
        where: { code: user.firstOrderDiscountCode },
      })
    : await tx.discountCode.findFirst({
        where: { userId, type: 'FIRST_ORDER' },
        orderBy: { createdAt: 'asc' },
      });
  const owned = await tx.promoCode.findFirst({
    where: {
      firstOrderOnly: true,
      OR: [
        { ownerUserId: userId },
        { ownerEmail: { equals: email, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  const code =
    user.firstOrderDiscountCode ??
    legacy?.code ??
    subscription?.welcomePromoCode?.code ??
    owned?.code ??
    (await generateDiscountCode(tx));
  if (legacy && (legacy.userId !== userId || legacy.type !== 'FIRST_ORDER'))
    throw new Error('WELCOME_CODE_OWNER_CONFLICT');
  let promo = await tx.promoCode.findUnique({ where: { code } });
  if (
    promo &&
    (!promo.firstOrderOnly ||
      normalizeEmail(promo.ownerEmail) !== email ||
      (promo.ownerUserId != null && promo.ownerUserId !== userId))
  )
    throw new Error('WELCOME_CODE_OWNER_CONFLICT');
  const redeemed =
    promo &&
    (await tx.promoCodeRedemption.findFirst({
      where: { promoCodeId: promo.id },
      select: { id: true },
    }));
  const consumed =
    user.firstOrderDiscountUsed ||
    Boolean(legacy?.used || legacy?.usedAt || redeemed || (promo && promo.usageCount > 0));
  if (!promo)
    promo = await tx.promoCode.create({
      data: {
        code,
        type: 'PERCENT',
        value: legacy?.percent ?? 10,
        ownerEmail: email,
        usageLimit: 1,
        singleUsePerUser: true,
        firstOrderOnly: true,
        isActive: !consumed,
        usageCount: consumed ? 1 : 0,
      },
    });
  // Existing codes, restrictions, expiration and consumption are never reset.
  if (!legacy)
    await tx.discountCode.create({
      data: {
        code,
        userId,
        type: 'FIRST_ORDER',
        percent: promo.value,
        used: consumed,
        ...(consumed ? { usedAt: new Date() } : {}),
      },
    });
  else if (consumed && !legacy.used)
    await tx.discountCode.update({
      where: { id: legacy.id },
      data: { used: true, usedAt: new Date() },
    });
  const updated =
    user.firstOrderDiscountCode === code &&
    (!consumed || user.firstOrderDiscountUsed)
      ? user
      : await tx.user.update({
          where: { id: userId },
          data: {
            firstOrderDiscountCode: code,
            ...(consumed ? { firstOrderDiscountUsed: true } : {}),
          },
        });
  if (subscription && subscription.welcomePromoCodeId !== promo.id)
    await tx.newsletterSubscription.update({
      where: { id: subscription.id },
      data: { welcomePromoCodeId: promo.id },
    });
  const previousJob = await tx.newsletterMailJob.findFirst({
    where: { kind: 'WELCOME', OR: [{ userId }, { email }] },
    select: { id: true, sentAt: true },
  });
  if (subscription && !subscription.welcomeSentAt && previousJob?.sentAt)
    await tx.newsletterSubscription.update({
      where: { id: subscription.id },
      data: { welcomeSentAt: previousJob.sentAt },
    });
  if (
    newlyCreated &&
    !previousJob &&
    !subscription?.welcomeSentAt &&
    !subscription?.welcomeClaimedAt
  ) {
    await tx.newsletterMailJob.create({
      data: { email, userId, kind: 'WELCOME' },
    });
  }
  return updated;
}
