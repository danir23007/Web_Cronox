import { OrderStatus } from '@prisma/client';
import { StripeWebhookController } from './stripe-webhook.controller';

describe('StripeWebhookController lifecycle safety', () => {
  let ordersService: any;
  let controller: StripeWebhookController;

  beforeEach(() => {
    ordersService = {
      reconcileStripePaymentLifecycle: jest.fn().mockResolvedValue(undefined),
      createOrderFromVerifiedStripePayment: jest.fn(),
      releaseCheckoutSnapshotForCanceledPaymentIntent: jest.fn(),
      claimOrderConfirmationEmail: jest.fn(),
      releaseOrderConfirmationEmailClaim: jest.fn(),
      markOrderConfirmationEmailSent: jest.fn(),
    };
    controller = new StripeWebhookController(
      {} as any,
      ordersService,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('does not turn a partial charge refund into a full order refund', async () => {
    const response = await (controller as any).handleChargeRefunded({
      data: {
        object: {
          payment_intent: 'pi_partial',
          refunded: false,
          amount: 1000,
          amount_refunded: 250,
        },
      },
    });

    expect(response).toEqual({ received: true, partial: true });
    expect(
      ordersService.reconcileStripePaymentLifecycle,
    ).not.toHaveBeenCalled();
  });

  it('reconciles a full charge refund from the persisted event timeline', async () => {
    const response = await (controller as any).handleChargeRefunded({
      data: {
        object: {
          payment_intent: 'pi_full',
          refunded: true,
          amount: 1000,
          amount_refunded: 1000,
        },
      },
    });

    expect(response).toEqual({ received: true });
    expect(ordersService.reconcileStripePaymentLifecycle).toHaveBeenCalledWith(
      'pi_full',
    );
  });

  it('reconciles disputes instead of applying the delivery event target directly', async () => {
    const response = await (controller as any).handleChargeDispute(
      {
        id: 'evt_dispute',
        type: 'charge.dispute.created',
        data: { object: { payment_intent: 'pi_dispute' } },
      },
      OrderStatus.DISPUTED,
    );

    expect(response).toEqual({ received: true });
    expect(ordersService.reconcileStripePaymentLifecycle).toHaveBeenCalledWith(
      'pi_dispute',
    );
  });

  it('restores a paid lifecycle when Stripe closes a warning without a formal dispute', () => {
    const lifecycle = (controller as any).getLifecycleStatus({
      type: 'charge.dispute.closed',
      data: { object: { status: 'warning_closed' } },
    });

    expect(lifecycle).toBe(OrderStatus.PAID);
  });

  it('defers a lost dispute lifecycle until its signed amount is compared with checkout total', () => {
    const lifecycle = (controller as any).getLifecycleStatus({
      type: 'charge.dispute.closed',
      data: { object: { status: 'lost', amount: 250 } },
    });

    expect(lifecycle).toBeUndefined();
  });

  it('records a closed lost dispute amount before reconciling its lifecycle', async () => {
    ordersService.recordStripeClosedLostDispute = jest
      .fn()
      .mockResolvedValue('PARTIAL');

    const response = await (controller as any).handleChargeDispute(
      {
        id: 'evt_loss',
        type: 'charge.dispute.closed',
        data: {
          object: { payment_intent: 'pi_loss', status: 'lost', amount: 250 },
        },
      },
      undefined,
      250,
    );

    expect(response).toEqual({ received: true });
    expect(ordersService.recordStripeClosedLostDispute).toHaveBeenCalledWith({
      eventId: 'evt_loss',
      paymentIntentId: 'pi_loss',
      amountCents: 250,
    });
    expect(ordersService.reconcileStripePaymentLifecycle).toHaveBeenCalledWith(
      'pi_loss',
    );
  });

  it('rejects Stripe test-mode events in production while permitting them outside production', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      expect(() =>
        (controller as any).assertLiveModeInProduction({ livemode: false }),
      ).toThrow('STRIPE_TEST_EVENT_REJECTED_IN_PRODUCTION');

      process.env.NODE_ENV = 'test';
      expect(() =>
        (controller as any).assertLiveModeInProduction({ livemode: false }),
      ).not.toThrow();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it('returns only receipt metadata from successful-payment webhooks', async () => {
    ordersService.createOrderFromVerifiedStripePayment.mockResolvedValue({
      orderId: 321,
      checkoutSnapshotId: 'snap_receipt',
      created: true,
      status: OrderStatus.REFUNDED,
    });

    const response = await (
      controller as any
    ).handleVerifiedPaymentIntentSucceeded(
      {
        id: 'pi_receipt',
        status: 'succeeded',
        amount: 1099,
        currency: 'eur',
        metadata: { checkoutSnapshotId: 'snap_receipt' },
      },
      new Date('2026-08-08T10:00:00.000Z'),
    );

    expect(response).toEqual({ received: true, created: true, orderId: 321 });
    expect(response).not.toHaveProperty('order');
  });

  it('keeps the reservation and cart intact after a retryable payment failure', async () => {
    const response = await (controller as any).handlePaymentIntentFailed({
      data: {
        object: { id: 'pi_retryable', status: 'requires_payment_method' },
      },
    });

    expect(response).toEqual({ received: true });
    expect(
      ordersService.releaseCheckoutSnapshotForCanceledPaymentIntent,
    ).not.toHaveBeenCalled();
    expect(
      ordersService.createOrderFromVerifiedStripePayment,
    ).not.toHaveBeenCalled();
  });

  it('releases only the reservation after Stripe terminally cancels an intent', async () => {
    const response = await (controller as any).handlePaymentIntentCanceled({
      data: { object: { id: 'pi_canceled', status: 'canceled' } },
    });

    expect(response).toEqual({ received: true });
    expect(
      ordersService.releaseCheckoutSnapshotForCanceledPaymentIntent,
    ).toHaveBeenCalledWith('pi_canceled');
    expect(
      ordersService.createOrderFromVerifiedStripePayment,
    ).not.toHaveBeenCalled();
  });
});
