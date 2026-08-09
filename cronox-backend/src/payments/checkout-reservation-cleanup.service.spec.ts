import { CheckoutReservationCleanupService } from './checkout-reservation-cleanup.service';

describe('CheckoutReservationCleanupService', () => {
  it('cancels a bound expired intent before releasing its stock reservation', async () => {
    const ordersService = {
      listExpiredCheckoutSnapshots: jest.fn().mockResolvedValue([
        { id: 'snap_unbound', stripePaymentIntentId: null },
        { id: 'snap_bound', stripePaymentIntentId: 'pi_expired' },
      ]),
      releaseCheckoutSnapshot: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      cancelCheckoutPaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CheckoutReservationCleanupService(
      ordersService as any,
      stripeService as any,
    );

    await (service as any).releaseExpiredReservations();

    expect(stripeService.cancelCheckoutPaymentIntent).toHaveBeenCalledWith(
      'pi_expired',
      'snap_bound',
    );
    expect(ordersService.releaseCheckoutSnapshot).toHaveBeenNthCalledWith(
      1,
      'snap_unbound',
      'EXPIRED',
      undefined,
    );
    expect(ordersService.releaseCheckoutSnapshot).toHaveBeenNthCalledWith(
      2,
      'snap_bound',
      'EXPIRED',
      'pi_expired',
    );
  });

  it('does not release stock when Stripe cancellation fails', async () => {
    const ordersService = {
      listExpiredCheckoutSnapshots: jest.fn().mockResolvedValue([
        { id: 'snap_bound', stripePaymentIntentId: 'pi_not_cancelled' },
      ]),
      releaseCheckoutSnapshot: jest.fn(),
    };
    const stripeService = {
      cancelCheckoutPaymentIntent: jest
        .fn()
        .mockRejectedValue(new Error('provider unavailable')),
    };
    const service = new CheckoutReservationCleanupService(
      ordersService as any,
      stripeService as any,
    );

    await (service as any).releaseExpiredReservations();

    expect(ordersService.releaseCheckoutSnapshot).not.toHaveBeenCalled();
  });
});
