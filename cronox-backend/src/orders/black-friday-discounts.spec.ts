import { OrdersService } from './orders.service';
import { CheckoutSummaryController } from './checkout-summary.controller';
import { blackFridayDiscountPolicy, BLACK_FRIDAY_START, BLACK_FRIDAY_END, BLACK_FRIDAY_PROMO_MESSAGE, promoDeadline } from '../common/black-friday-discounts';

function fixture() {
  const settings = { startsAt: new Date(BLACK_FRIDAY_START), endsAt: new Date(BLACK_FRIDAY_END), enabled: false };
  const promo = { id: 1, code: 'SAVE', type: 'PERCENT', value: 10, startsAt: null, expiresAt: null, isActive: true, singleUsePerUser: false, usageLimit: 100, usageCount: 0 };
  const db: any = { blackFridaySettings: { findUnique: jest.fn().mockResolvedValue(settings) }, promoCode: { findFirst: jest.fn().mockResolvedValue(promo), updateMany: jest.fn() }, promoCodeRedemption: { create: jest.fn() },
    checkoutSnapshot: { findMany: jest.fn().mockResolvedValue([]) } };
  const method = { id: 1, code: 'STANDARD', label: 'Estándar', priceCents: 0, amountCents: 0 };
  const cart: any = { id: 1, userId: 5, updatedAt: new Date(), items: [{ id: 1, variantId: 1, qty: 1, priceAtAdd: 5000,
    variant: { id: 1, isActive: true, stockQty: 10, price: null, product: { id: 1, isActive: true, price: 5000, currency: 'EUR' } } }] };
  const shipping = { listAvailableMethods: jest.fn().mockResolvedValue([method]), getMethod: jest.fn().mockResolvedValue(method) };
  const service = new OrdersService(db, {} as any, { getTaxRate: () => 0.21 } as any, shipping as any, {} as any, {} as any);
  const controller = new CheckoutSummaryController(service, { getCheckoutCartForRequest: async () => cart } as any);
  return { db, settings, promo, cart, service, controller, method };
}
describe('Black Friday non-stackable discount codes (server clock)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it.each([
    ['2026-11-26T19:59:59.999Z', false], ['2026-11-26T20:00:00.000Z', true],
    ['2026-11-27T12:00:00.000Z', true], ['2026-11-27T22:59:59.999Z', true],
    ['2026-11-27T23:00:00.000Z', false],
  ])('enforces the exact inclusive/exclusive boundary %s', async (time, blocked) => {
    jest.setSystemTime(new Date(time));
    const { db, service, cart } = fixture();
    const policy = await blackFridayDiscountPolicy(db);
    expect(policy.blocked).toBe(blocked);
    const summary = await service.getCheckoutSummary(cart, { promoCode: 'SAVE', shippingMethod: 'STANDARD' as any });
    expect(summary.appliedPromo?.valid).toBe(!blocked);
    expect(summary.totals.discountCents).toBe(blocked ? 0 : 500);
    expect(summary.totals.totalCents).toBe(blocked ? 5000 : 4500);
    expect(db.promoCode.updateMany).not.toHaveBeenCalled();
    expect(db.promoCodeRedemption.create).not.toHaveBeenCalled();
  });
  it.each(['PERCENT', 'FIXED', 'WELCOME', 'AUTO', 'CIRCLE_5', 'UNKNOWN'])('blocks every source/type without even querying or consuming the code: %s', async code => {
    jest.setSystemTime(new Date(BLACK_FRIDAY_START));
    const { service, db, cart, controller } = fixture();
    const summary = await service.getCheckoutSummary(cart, { promoCode: code });
    expect(summary.appliedPromo).toMatchObject({ valid: false, discountCents: 0, message: BLACK_FRIDAY_PROMO_MESSAGE });
    await expect(controller.applyPromo({ user: { id: 5 } } as any, { code, shippingMethod: 'STANDARD' } as any)).rejects.toMatchObject({ response: { code: 'PROMO_BLACK_FRIDAY', message: BLACK_FRIDAY_PROMO_MESSAGE } });
    expect(db.promoCode.findFirst).not.toHaveBeenCalled();
    expect(db.promoCode.updateMany).not.toHaveBeenCalled();
  });
  it('removes a previously applied discount while preserving the actual product offer', async () => {
    jest.setSystemTime(new Date('2026-11-26T19:59:59Z'));
    const { service, cart } = fixture();
    expect((await service.getCheckoutSummary(cart, { promoCode: 'SAVE' })).totals.discountCents).toBe(500);
    const product = cart.items[0].variant.product;
    Object.assign(product, { activeLotId: 'lot', inventoryLots: [{ id: 'lot', webOfferPriceCents: 2200, webOfferPreviousCents: 5000, webOfferStartsAt: BLACK_FRIDAY_START, webOfferEndsAt: BLACK_FRIDAY_END, webOfferConfirmedAt: new Date('2026-11-25') }] });
    Object.assign(cart.items[0], { lotAtAdd: 'lot', priceAtAdd: 2200 });
    jest.setSystemTime(new Date(BLACK_FRIDAY_START));
    const result = await service.getCheckoutSummary(cart, { promoCode: 'SAVE' });
    expect(result.totals).toMatchObject({ subtotalCents: 2200, discountCents: 0, totalCents: 2200 });
    expect(result.appliedPromo?.message).toBe(BLACK_FRIDAY_PROMO_MESSAGE);
  });
  it('caps discounted reservations at the boundary and blocks a direct payment-start call', async () => {
    jest.setSystemTime(new Date('2026-11-26T19:59:00Z'));
    const { db, service } = fixture();
    const policy = await blackFridayDiscountPolicy(db);
    expect(promoDeadline(new Date('2026-11-26T20:05:00Z'), true, policy).toISOString()).toBe(BLACK_FRIDAY_START);
    expect(promoDeadline(new Date('2026-11-26T20:05:00Z'), false, policy).toISOString()).toBe('2026-11-26T20:05:00.000Z');
    jest.setSystemTime(new Date(BLACK_FRIDAY_START));
    db.$transaction = async (callback: any) => callback(db);
    db.checkoutSnapshot.updateMany = jest.fn().mockResolvedValue({ count: 1 });
    db.checkoutSnapshot.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'old', status: 'PAYMENT_BOUND', promoCodeId: 1, discountCents: 500, stripePaymentIntentId: 'pi_old', expiresAt: new Date('2026-11-26T20:05:00Z') });
    await expect(service.startCheckoutPayment({ userId: 5 }, 1, 'old', 'pi_old', 'tab')).rejects.toMatchObject({ response: { code: 'PROMO_BLACK_FRIDAY' } });
  });
  it('reconciles pre-existing discounted attempts through the existing expiry worker, leaving completed orders out', async () => {
    jest.setSystemTime(new Date(BLACK_FRIDAY_START));
    const { db, service } = fixture();
    await service.listExpiredCheckoutSnapshots();
    const query = db.checkoutSnapshot.findMany.mock.calls[0][0];
    expect(query.where.AND[0].OR).toContainEqual({ OR: [{ promoCodeId: { not: null } }, { promoCodeCode: { not: null } }, { discountCents: { gt: 0 } }] });
    expect(query.where.OR).toEqual([{ orderId: null }, { status: 'BANK_TRANSFER_PENDING' }]);
    expect(query.where.status.in).not.toContain('PROCESSED');
  });
});
