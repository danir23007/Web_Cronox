import { OrderStatus } from '@prisma/client';
import { StripeWebhookController } from './stripe-webhook.controller';

describe('StripeWebhookController lifecycle safety', () => {
  let ordersService: any;
  let authService: any;
  let controller: StripeWebhookController;

  beforeEach(() => {
    ordersService = {
      reconcileStripePaymentLifecycle: jest.fn().mockResolvedValue(undefined),
      createOrderFromVerifiedStripePayment: jest.fn(),
      releaseCheckoutSnapshotForCanceledPaymentIntent: jest.fn(),
      claimOrderConfirmationEmail: jest.fn(),
      releaseOrderConfirmationEmailClaim: jest.fn().mockResolvedValue(undefined),
      markOrderConfirmationEmailSent: jest.fn(),
    };
    authService = {
      sendInitialPasswordSetupIfNeeded: jest.fn().mockResolvedValue(undefined),
    };
    controller = new StripeWebhookController(
      {} as any,
      ordersService,
      {} as any,
      {} as any,
      {} as any,
      authService,
    );
  });
  it.each(['NEW_ACCOUNT', 'EXISTING_PASSWORDLESS', 'NOT_NEEDED', null])('recovers initial setup from persisted scenario %s only', async accountScenario => {
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue({ id: 18, userId: 42, status: 'PAID' }) } };
    const hook = new StripeWebhookController({} as any, ordersService, {} as any, prisma as any, {} as any, authService);
    await (hook as any).deliverEffect({ kind: 'INITIAL_SETUP', orderId: 18, userId: 42, accountScenario });
    if (['NEW_ACCOUNT', 'EXISTING_PASSWORDLESS'].includes(accountScenario || ''))
      expect(authService.sendInitialPasswordSetupIfNeeded).toHaveBeenCalledWith(42, { scenario: accountScenario, orderId: 18 });
    else expect(authService.sendInitialPasswordSetupIfNeeded).not.toHaveBeenCalled();
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

  it('persists only a signature-verified event through the recovery queue', async () => {
    const event = { id: 'evt_refund', type: 'charge.refunded', created: 1790194651, livemode: false,
      data: { object: { payment_intent: 'pi_retry', refunded: true, amount: 320, amount_refunded: 320 } } };
    const recovery = { register: jest.fn(), accept: jest.fn().mockResolvedValue({ received: true, queued: true }) };
    const webhook = new StripeWebhookController({ constructEventFromPayload: () => event } as any, ordersService, {} as any, {} as any, {} as any, authService, undefined, recovery as any);
    await expect(webhook.handleStripeWebhook({ body: Buffer.from('{}') } as any, undefined, 'signature')).resolves.toEqual({ received: true, queued: true });
    expect(recovery.accept).toHaveBeenCalledWith(event, expect.objectContaining({ paymentIntentId: 'pi_retry', lifecycleStatus: 'REFUNDED', refundCumulativeCents: 320 }));
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
    expect(ordersService.claimOrderConfirmationEmail).not.toHaveBeenCalled();
    expect(authService.sendInitialPasswordSetupIfNeeded).not.toHaveBeenCalled();
  });

  it('defers password setup to the durable auxiliary worker', async () => {
    ordersService.createOrderFromVerifiedStripePayment.mockResolvedValue({
      orderId: 322,
      userId: 77,
      checkoutSnapshotId: 'snap_paid_guest',
      created: true,
      accountCreated: true,
      status: OrderStatus.PAID,
    });
    ordersService.claimOrderConfirmationEmail.mockResolvedValue(false);

    await (controller as any).handleVerifiedPaymentIntentSucceeded(
      {
        id: 'pi_paid_guest',
        status: 'succeeded',
        amount: 1099,
        currency: 'eur',
        metadata: { checkoutSnapshotId: 'snap_paid_guest' },
      },
      new Date('2026-08-08T10:00:00.000Z'),
    );

    expect(authService.sendInitialPasswordSetupIfNeeded).not.toHaveBeenCalled();
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
    expect(authService.sendInitialPasswordSetupIfNeeded).not.toHaveBeenCalled();
  });

  it('does not invalidate a paid order when password-setup delivery orchestration fails', async () => {
    ordersService.createOrderFromVerifiedStripePayment.mockResolvedValue({
      orderId: 323,
      userId: 78,
      checkoutSnapshotId: 'snap_paid_email_failure',
      created: true,
      accountCreated: true,
      status: OrderStatus.PAID,
    });
    authService.sendInitialPasswordSetupIfNeeded.mockRejectedValue(
      new Error('email unavailable'),
    );
    ordersService.claimOrderConfirmationEmail.mockResolvedValue(false);

    await expect(
      (controller as any).handleVerifiedPaymentIntentSucceeded(
        {
          id: 'pi_paid_email_failure',
          status: 'succeeded',
          amount: 1099,
          currency: 'eur',
          metadata: { checkoutSnapshotId: 'snap_paid_email_failure' },
        },
        new Date('2026-08-08T10:00:00.000Z'),
      ),
    ).resolves.toEqual({ received: true, created: true, orderId: 323 });
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

  it('keeps uncertain confirmation under explicit review instead of sending again', async () => {
    const prisma = { checkoutSnapshot: { findUnique: jest.fn().mockResolvedValue({ id: 'snap_mail', order: { status: 'PAID' } }) },
      checkoutEffect: { findUnique: jest.fn().mockResolvedValue({ id: 'effect' }), findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'REVIEW' }) } };
    const email = { send: jest.fn() };
    const recovery = { register: jest.fn(), processEffects: jest.fn() };
    const retryController = new StripeWebhookController({} as any, ordersService, email as any, prisma as any, {} as any, authService, undefined, recovery as any);
    await expect(retryController.retryOrderConfirmationEmail(18)).resolves.toEqual({ outcome: 'REVIEW' });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('does not deliver confirmation for a refunded order', async () => {
    const email = { send: jest.fn() };
    const retryController = new StripeWebhookController({} as any, ordersService, email as any,
      { order: { findUnique: jest.fn().mockResolvedValue({ status: 'REFUNDED' }) } } as any, {} as any, authService);
    await expect((retryController as any).deliverEffect({ kind: 'ORDER_CONFIRMATION', orderId: 18 })).resolves.toBe('not_needed');
    expect(email.send).not.toHaveBeenCalled();
  });

  it('never refunds a transient failure or an uncertain committed result', async () => {
    const stripe = { refundPaymentIntent: jest.fn() };
    const c = new StripeWebhookController(stripe as any, ordersService, {} as any, {} as any, {} as any, authService);
    ordersService.createOrderFromVerifiedStripePayment.mockRejectedValue(new Error('connection lost after commit'));
    await expect((c as any).handleVerifiedPaymentIntentSucceeded({ id: 'pi_paid', status: 'succeeded', amount: 100, currency: 'eur', metadata: { checkoutSnapshotId: 'snap' } }, new Date())).rejects.toThrow('connection lost');
    expect(stripe.refundPaymentIntent).not.toHaveBeenCalled();
  });

  it('does not fail persisted order confirmation when claiming email fails', async () => {
    ordersService.createOrderFromVerifiedStripePayment.mockResolvedValue({ orderId: 19, userId: 2, checkoutSnapshotId: 'snap_mail', status: 'PAID', created: true });
    ordersService.claimOrderConfirmationEmail.mockRejectedValue(new Error('database unavailable'));
    await expect((controller as any).handleVerifiedPaymentIntentSucceeded({ id: 'pi_mail', status: 'succeeded', amount_received: 320, currency: 'eur', metadata: { checkoutSnapshotId: 'snap_mail' } }, new Date())).resolves.toMatchObject({ orderId: 19, created: true });
  });
});
