/** Shared server policy. Visual enablement never exempts a discount code. */
export const BLACK_FRIDAY_START = '2026-11-26T20:00:00.000Z';
export const BLACK_FRIDAY_END = '2026-11-27T23:00:00.000Z';
export const BLACK_FRIDAY_PROMO_MESSAGE = 'Los códigos de descuento no son acumulables con las ofertas de Black Friday.';
export type BlackFridayDiscountPolicy = {
  blocked: boolean; message: string; startsAt: string; endsAt: string; serverNow: string;
};
export async function blackFridayDiscountPolicy(client: any, clock?: Date): Promise<BlackFridayDiscountPolicy> {
  const settings = await client.blackFridaySettings?.findUnique?.({ where: { id: 'global' }, select: { startsAt: true, endsAt: true } });
  const now = clock ?? new Date();
  const start = new Date(settings?.startsAt ?? BLACK_FRIDAY_START);
  const end = new Date(settings?.endsAt ?? BLACK_FRIDAY_END);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || +end <= +start) throw Error('BLACK_FRIDAY_DATES_INVALID');
  return { blocked: +now >= +start && +now < +end, message: BLACK_FRIDAY_PROMO_MESSAGE,
    startsAt: start.toISOString(), endsAt: end.toISOString(), serverNow: now.toISOString() };
}
export function promoDeadline(expiry: Date, hasPromo: boolean, policy: BlackFridayDiscountPolicy): Date {
  if (!hasPromo || +new Date(policy.serverNow) >= +new Date(policy.endsAt)) return expiry;
  return new Date(Math.min(+expiry, +new Date(policy.startsAt)));
}
export function hasSnapshotPromo(snapshot: { promoCodeId?: number | null; promoCodeCode?: string | null; discountCents?: number }) {
  return Boolean(snapshot.promoCodeId || snapshot.promoCodeCode || (snapshot.discountCents ?? 0) > 0);
}
