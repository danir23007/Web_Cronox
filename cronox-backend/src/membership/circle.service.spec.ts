import { BadRequestException, ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { CircleService } from './circle.service';
import { CircleReconciliationService } from './circle-reconciliation.service';
import { circle2Eligibility, getNetSpendCents, reconcileCircle2, CIRCLE_II_COOLDOWN_MS } from './circle-policy';
import { FinanceOrder } from '../admin/finance/financial-calculations';

const now = new Date('2026-10-17T12:00:00Z');
const entered = new Date(now.getTime() - CIRCLE_II_COOLDOWN_MS);
const sale = (id: number, total: string, overrides: Partial<FinanceOrder> = {}): FinanceOrder => ({
  id, source: 'ONLINE', status: 'PAID', currency: 'EUR', providerRef: `pi_${id}`,
  paidAt: new Date('2026-10-01T12:00:00Z'), purchasedAt: null, createdAt: new Date('2026-10-01T12:00:00Z'), voidedAt: null,
  total, shippingCost: 0, discountCents: 0, disputeLostCents: 0, stockMovements: [],
  items: [{ id, productId: 1, variantId: id, title: 'Shirt', quantity: 1, lineTotal: total,
    financialSnapshot: { unitCostCents: 1000, productName: 'Shirt', imageUrl: null } }], ...overrides,
});
function fixture(orders: FinanceOrder[], events: any[] = []) {
  const user = { id: 7, circleLevel: 1, circle2PromotedAt: null as Date | null };
  const tx: any = {
    user: { findUnique: jest.fn(async () => ({ ...user })), updateMany: jest.fn(async ({ data }) => { Object.assign(user, data); return { count: 1 }; }) },
    order: { findMany: jest.fn(async () => orders.map(order => ({ id: order.id, userId: 7 }))) },
    financeArchive: { findMany: jest.fn(async () => orders.map(order => ({ orderId: order.id, providerRef: order.providerRef, snapshot: order }))) },
    financeEventArchive: { findMany: jest.fn(async () => events) },
    financeStockArchive: { findMany: jest.fn(async () => []) },
    circlePromotionRequest: { findUnique: jest.fn(async () => null), create: jest.fn(async ({ data }) => ({ id: 1, ...data })) },
    circleUpgradeRequest: { findFirst: jest.fn(async () => null) },
    $queryRaw: jest.fn(async () => [{ id: 7 }]),
  };
  tx.$transaction = jest.fn(async fn => fn(tx));
  const upgrades = { ensureAutoRequestForCircle2To3: jest.fn() };
  return { tx, user, upgrades, service: new CircleService(tx, upgrades as any) };
}

describe('circle spending and persistent promotion', () => {
  it.each([[84.99, false], [85, true], [87.50, true], [90, true]])('promotes at the inclusive 85 EUR boundary: %s', async (amount, expected) => {
    const { tx, user } = fixture([sale(1, String(amount))]);
    const result = await reconcileCircle2(tx, 7, now);
    expect(result.changed).toBe(expected);
    expect(user.circleLevel).toBe(expected ? 2 : 1);
    expect(user.circle2PromotedAt).toEqual(expected ? now : null);
    if (expected) {
      expect((await reconcileCircle2(tx, 7, new Date(now.getTime() + 1000))).changed).toBe(false);
      expect(user.circle2PromotedAt).toEqual(now);
    }
  });
  it('adds online and excluded manual paid purchases and ignores pending/cancelled purchases', async () => {
    const { tx, service } = fixture([sale(1, '40'), sale(2, '45', { source: 'IN_PERSON_ADMIN', excludedFromStatistics: true }),
      sale(3, '500', { status: 'PENDING' }), sale(4, '500', { status: 'CANCELLED' })]);
    expect(await getNetSpendCents(tx, 7, now)).toBe(8500);
    await expect(service.getNetSpent(7)).resolves.toEqual(new Decimal(85));
    expect((await reconcileCircle2(tx, 7, now)).changed).toBe(true);
  });
  it('subtracts actual cumulative refunds once before assessing eligibility', async () => {
    const refund = { paymentIntentId: 'pi_1', occurredAt: now, snapshot: {
      id: 'refund', type: 'charge.refunded', paymentIntentId: 'pi_1', refundCumulativeCents: 1501,
    } };
    const { tx } = fixture([sale(1, '100')], [refund, { ...refund, snapshot: { ...refund.snapshot, id: 'replayed-refund' } }]);
    expect(await getNetSpendCents(tx, 7, now)).toBe(8499);
    expect((await reconcileCircle2(tx, 7, now)).changed).toBe(false);
  });
  it('does not promote when the archived financial evidence has unknown currency', async () => {
    const { tx } = fixture([sale(1, '100', { currency: 'USD' })]);
    expect((await reconcileCircle2(tx, 7, now)).changed).toBe(false);
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
  it.each([2, 3, 4, 5])('preserves level %s and its existing effective date after refunds or retries', async circleLevel => {
    const { tx, user } = fixture([]);
    Object.assign(user, { circleLevel, circle2PromotedAt: entered });
    expect((await reconcileCircle2(tx, 7, now)).changed).toBe(false);
    expect(user).toMatchObject({ circleLevel, circle2PromotedAt: entered });
    expect(tx.user.updateMany).not.toHaveBeenCalled();
  });
});

describe('server-authoritative 30 complete days and request guards', () => {
  it('opens exactly at eligibleAt, including a one-millisecond boundary', () => {
    const user = { circleLevel: 2, circle2PromotedAt: entered };
    expect(circle2Eligibility(user, false, new Date(now.getTime() - 1))).toMatchObject({ canRequest: false, cooldownMs: 1, eligibleAt: now, blockedReason: 'cooldown' });
    expect(circle2Eligibility(user, false, now)).toMatchObject({ canRequest: true, cooldownMs: 0, serverTime: now, eligibleAt: now });
    expect(circle2Eligibility(user, true, now)).toMatchObject({ canRequest: false, blockedReason: 'pending' });
  });
  it.each([null, new Date(now.getTime() + 1)])('keeps an unknown/future effective date blocked without an invented countdown: %s', circle2PromotedAt => {
    expect(circle2Eligibility({ circleLevel: 2, circle2PromotedAt }, false, now)).toMatchObject({
      canRequest: false, eligibleAt: null, blockedReason: 'promotion_date_unknown',
    });
  });
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());
  it('rejects a direct API request before the full wait and leaves the existing request path untouched', async () => {
    const { tx, user, upgrades, service } = fixture([]);
    Object.assign(user, { circleLevel: 2, circle2PromotedAt: new Date(entered.getTime() + 1) });
    await expect(service.requestPromotion(7)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.circlePromotionRequest.create).not.toHaveBeenCalled();
    expect(upgrades.ensureAutoRequestForCircle2To3).not.toHaveBeenCalled();
  });
  it('creates the existing request and its admin mirror atomically after eligibility', async () => {
    const { tx, user, upgrades, service } = fixture([]);
    Object.assign(user, { circleLevel: 2, circle2PromotedAt: entered });
    const request = await service.requestPromotion(7);
    expect(request.status).toBe('pending');
    expect(request.promoteAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
    expect(request.promoteAt.getTime()).toBeLessThan(now.getTime() + 72 * 3600000);
    expect(tx.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    expect(upgrades.ensureAutoRequestForCircle2To3).toHaveBeenCalledWith(7, request.promoteAt, tx);
    expect(user.circleLevel).toBe(2);
  });
  it('blocks an already pending request even when the timer has expired', async () => {
    const { tx, user, service } = fixture([]);
    Object.assign(user, { circleLevel: 2, circle2PromotedAt: entered });
    tx.circlePromotionRequest.findUnique.mockResolvedValue({ status: 'pending' });
    await expect(service.requestPromotion(7)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.circlePromotionRequest.create).not.toHaveBeenCalled();
  });
  it('runs the internal queue worker even when optional external background jobs are disabled', async () => {
    const previousJobs = process.env.BACKGROUND_JOBS_ENABLED;
    const previousSmoke = process.env.CRONOX_ROUTE_SMOKE_MODE;
    process.env.BACKGROUND_JOBS_ENABLED = 'false'; delete process.env.CRONOX_ROUTE_SMOKE_MODE;
    const worker = new CircleReconciliationService({} as any);
    const drain = jest.spyOn(worker, 'drainQueue').mockResolvedValue(0);
    try {
      worker.onModuleInit();
      await jest.advanceTimersByTimeAsync(1000);
      expect(drain).toHaveBeenCalledTimes(2);
    } finally {
      worker.onModuleDestroy();
      if (previousJobs === undefined) delete process.env.BACKGROUND_JOBS_ENABLED; else process.env.BACKGROUND_JOBS_ENABLED = previousJobs;
      if (previousSmoke === undefined) delete process.env.CRONOX_ROUTE_SMOKE_MODE; else process.env.CRONOX_ROUTE_SMOKE_MODE = previousSmoke;
    }
  });
});
