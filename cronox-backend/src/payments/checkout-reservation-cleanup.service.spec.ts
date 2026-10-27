import { CheckoutReservationCleanupService } from './checkout-reservation-cleanup.service';

describe('checkout expiry reconciliation', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-10-27T12:00:00Z')); });
  afterEach(() => jest.useRealTimers());
  function setup(status = 'canceled') {
    const snapshot = { id: 'snap', stripePaymentIntentId: 'pi_test', stripeAccountId: 'acct_test', totalCents: 1000, currency: 'EUR', status: 'PAYMENT_BOUND' };
    const orders: any = {
      pruneCheckoutPresence: jest.fn().mockResolvedValue(undefined),
      listExpiredCheckoutSnapshots: jest.fn().mockResolvedValue([snapshot]),
      claimCheckoutExpiry: jest.fn().mockResolvedValue(snapshot),
      deferCheckoutReconciliation: jest.fn().mockResolvedValue(undefined),
      releaseCheckoutSnapshot: jest.fn().mockResolvedValue(undefined),
      createOrderFromVerifiedStripePayment: jest.fn().mockResolvedValue({}),
      reconcileStripePaymentLifecycle: jest.fn().mockResolvedValue(undefined),
    };
    const stripe = { reconcileExpiredCheckoutPayment: jest.fn().mockResolvedValue({ status, amount_received: 1000, currency: 'eur' }) };
    return { orders, stripe, service: new CheckoutReservationCleanupService(orders, stripe as any) };
  }
  it('requires the database expiry claim and confirmed cancellation before release', async () => {
    const { service, orders, stripe } = setup();
    await service.reconcile('snap');
    expect(orders.claimCheckoutExpiry).toHaveBeenCalledWith('snap');
    expect(stripe.reconcileExpiredCheckoutPayment).toHaveBeenCalledWith({ checkoutSnapshotId: 'snap', paymentIntentId: 'pi_test', stripeAccountId: 'acct_test', amount: 1000, currency: 'EUR' });
    expect(orders.releaseCheckoutSnapshot).toHaveBeenCalledWith('snap', 'EXPIRED', 'pi_test');
  });
  it('a presence renewal winning the database claim prevents cancellation', async () => {
    const { service, orders, stripe } = setup(); orders.claimCheckoutExpiry.mockResolvedValue(null);
    await service.reconcile('snap'); expect(stripe.reconcileExpiredCheckoutPayment).not.toHaveBeenCalled(); expect(orders.releaseCheckoutSnapshot).not.toHaveBeenCalled();
  });
  it.each(['processing', 'requires_action'])('retains inventory on uncertain provider state %s', async status => {
    const { service, orders } = setup(status); await service.reconcile('snap');
    expect(orders.releaseCheckoutSnapshot).not.toHaveBeenCalled(); expect(orders.deferCheckoutReconciliation).toHaveBeenCalled();
  });
  it('reconciles a paid attempt, including success winning cancellation, without returning inventory', async () => {
    const { service, orders } = setup('succeeded'); await service.reconcile('snap');
    expect(orders.createOrderFromVerifiedStripePayment).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_test', amountCents: 1000 }));
    expect(orders.releaseCheckoutSnapshot).not.toHaveBeenCalled();
  });
  it('provider failure is retryable and leaves units held', async () => {
    const { service, orders, stripe } = setup(); stripe.reconcileExpiredCheckoutPayment.mockRejectedValue(new Error('timeout'));
    expect(await service.reconcile('snap')).toBe(false); expect(orders.releaseCheckoutSnapshot).not.toHaveBeenCalled(); expect(orders.deferCheckoutReconciliation).toHaveBeenCalledWith('snap');
  });
  it('runs immediately on startup and at one-second intervals, without overlapping runs', async () => {
    const { service, orders } = setup(); const old = process.env.BACKGROUND_JOBS_ENABLED;
    process.env.BACKGROUND_JOBS_ENABLED = 'true';
    try { service.onModuleInit(); await jest.advanceTimersByTimeAsync(3000); expect(orders.listExpiredCheckoutSnapshots).toHaveBeenCalledTimes(4); }
    finally { service.onModuleDestroy(); if (old === undefined) delete process.env.BACKGROUND_JOBS_ENABLED; else process.env.BACKGROUND_JOBS_ENABLED = old; }
  });
});
