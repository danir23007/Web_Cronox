import type { Prisma } from '@prisma/client';
import { loadUserPurchaseMetrics } from '../admin/users/user-purchase-metrics';

export const CIRCLE_II_THRESHOLD_CENTS = 8500;
export const CIRCLE_II_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export async function getNetSpendCents(tx: Prisma.TransactionClient, userId: number, now = new Date()) {
  return (await loadUserPurchaseMetrics(tx, [userId], now)).get(userId)!.revenueCents;
}

// Call inside a serializable transaction after financial snapshots are committed.
// This function is also the single entry point for explicit historical repair.
export async function reconcileCircle2(tx: Prisma.TransactionClient, userId: number, effectiveAt = new Date()) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, circleLevel: true, circle2PromotedAt: true } });
  if (!user || user.circleLevel !== 1) return { changed: false, userId, netSpendCents: null };
  const netSpendCents = await getNetSpendCents(tx, userId, effectiveAt);
  if (netSpendCents === null || netSpendCents < CIRCLE_II_THRESHOLD_CENTS) return { changed: false, userId, netSpendCents };
  const promotedAt = user.circle2PromotedAt ?? effectiveAt;
  const result = await tx.user.updateMany({
    where: { id: userId, circleLevel: 1, circle2PromotedAt: user.circle2PromotedAt },
    data: { circleLevel: 2, circle2PromotedAt: promotedAt },
  });
  return { changed: result.count === 1, userId, netSpendCents, promotedAt };
}

export function circle2Eligibility(user: { circleLevel: number; circle2PromotedAt: Date | null }, hasPending: boolean, now = new Date()) {
  const promotedAt = user.circle2PromotedAt;
  const validDate = promotedAt && Number.isFinite(promotedAt.getTime()) && promotedAt <= now;
  const eligibleAt = validDate ? new Date(promotedAt.getTime() + CIRCLE_II_COOLDOWN_MS) : null;
  const cooldownMs = eligibleAt ? Math.max(0, eligibleAt.getTime() - now.getTime()) : 0;
  const blockedReason = hasPending ? 'pending' : user.circleLevel !== 2 ? 'circle'
    : !eligibleAt ? 'promotion_date_unknown' : cooldownMs > 0 ? 'cooldown' : null;
  return { fromCircle: 2, toCircle: 3, canRequest: blockedReason === null, hasPending,
    circle2PromotedAt: promotedAt, eligibleAt, serverTime: now, cooldownMs, blockedReason };
}
