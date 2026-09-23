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

  it('keeps failed event processing retryable and deduplicates completed delivery', async () => {
    const event = { id: 'evt_refund_retry', type: 'charge.refunded', created: 1790194651, livemode: true,
      data: { object: { payment_intent: 'pi_retry', refunded: true, amount: 320, amount_refunded: 320 } } };
    const webhook = new StripeWebhookController({ constructEventFromPayload: () => event } as any, ordersService, {} as any, {} as any, {} as any, authService);
    ordersService.claimStripeWebhookEvent = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    ordersService.failStripeWebhookEvent = jest.fn().mockResolvedValue(undefined);
    ordersService.completeStripeWebhookEvent = jest.fn().mockResolvedValue(undefined);
    ordersService.reconcileStripePaymentLifecycle.mockRejectedValueOnce(new Error('temporary database failure')).mockResolvedValue(undefined);
    const req = { body: Buffer.from('{}') } as any;
    await expect(webhook.handleStripeWebhook(req, undefined, 'mock-signature')).rejects.toThrow('temporary database failure');
    expect(ordersService.failStripeWebhookEvent).toHaveBeenCalledWith(event.id, expect.any(Error));
    expect(ordersService.completeStripeWebhookEvent).not.toHaveBeenCalled();
    await expect(webhook.handleStripeWebhook(req, undefined, 'mock-signature')).resolves.toEqual({ received: true });
    await expect(webhook.handleStripeWebhook(req, undefined, 'mock-signature')).resolves.toEqual({ received: true, duplicate: true });
    expect(ordersService.reconcileStripePaymentLifecycle).toHaveBeenCalledTimes(2);
    expect(ordersService.completeStripeWebhookEvent).toHaveBeenCalledTimes(1);
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

  it('requests password setup only after the authoritative paid-order result', async () => {
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

    expect(authService.sendInitialPasswordSetupIfNeeded).toHaveBeenCalledWith(
      77,
    );
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

  it('retries a failed confirmation independently of webhook deduplication and marks only accepted mail', async () => {
    const prisma = {
      checkoutSnapshot: { findUnique: jest.fn().mockResolvedValue({ id: 'snap_mail', order: { status: 'PAID' } }) },
      order: { findUnique: jest.fn().mockResolvedValue({ status: 'PAID', customerEmail: 'buyer@example.test' }) },
    };
    const email = { send: jest.fn().mockRejectedValueOnce(new Error('SMTP unavailable')).mockResolvedValueOnce({ messageId: 'accepted' }) };
    const mapper = { map: jest.fn().mockReturnValue({}) };
    const retryController = new StripeWebhookController({} as any, ordersService, email as any, prisma as any, mapper as any, authService);
    ordersService.claimOrderConfirmationEmail.mockResolvedValue(true);
    await expect(retryController.retryOrderConfirmationEmail(18)).resolves.toEqual({ outcome: 'retry_required' });
    expect(ordersService.markOrderConfirmationEmailSent).not.toHaveBeenCalled();
    expect(ordersService.releaseOrderConfirmationEmailClaim).toHaveBeenCalledWith('snap_mail');
    await expect(retryController.retryOrderConfirmationEmail(18)).resolves.toEqual({ outcome: 'accepted' });
    expect(ordersService.markOrderConfirmationEmailSent).toHaveBeenCalledTimes(1);
    ordersService.claimOrderConfirmationEmail.mockResolvedValue(false);
    await expect(retryController.retryOrderConfirmationEmail(18)).resolves.toEqual({ outcome: 'already_sent_or_claimed' });
    expect(email.send).toHaveBeenCalledTimes(2);
  });

  it('refuses a paid confirmation after a refund, including a refund between claim and read', async () => {
    const prisma = {
      checkoutSnapshot: { findUnique: jest.fn().mockResolvedValue({ id: 'snap_refunded', order: { status: 'REFUNDED' } }) },
      order: { findUnique: jest.fn().mockResolvedValue({ status: 'REFUNDED', customerEmail: 'buyer@example.test' }) },
    };
    const email = { send: jest.fn() };
    const retryController = new StripeWebhookController({} as any, ordersService, email as any, prisma as any, {} as any, authService);
    await expect(retryController.retryOrderConfirmationEmail(18)).resolves.toEqual({ outcome: 'not_paid' });
    expect(ordersService.claimOrderConfirmationEmail).not.toHaveBeenCalled();
    prisma.checkoutSnapshot.findUnique.mockResolvedValue({ id: 'snap_refunded', order: { status: 'PAID' } });
    ordersService.claimOrderConfirmationEmail.mockResolvedValue(true);
    await expect(retryController.retryOrderConfirmationEmail(18)).resolves.toEqual({ outcome: 'unavailable' });
    expect(email.send).not.toHaveBeenCalled();
    expect(ordersService.markOrderConfirmationEmailSent).not.toHaveBeenCalled();
  });

  it('does not fail persisted order confirmation when claiming email fails', async () => {
    ordersService.createOrderFromVerifiedStripePayment.mockResolvedValue({ orderId: 19, userId: 2, checkoutSnapshotId: 'snap_mail', status: 'PAID', created: true });
    ordersService.claimOrderConfirmationEmail.mockRejectedValue(new Error('database unavailable'));
    await expect((controller as any).handleVerifiedPaymentIntentSucceeded({ id: 'pi_mail', status: 'succeeded', amount_received: 320, currency: 'eur', metadata: { checkoutSnapshotId: 'snap_mail' } }, new Date())).resolves.toMatchObject({ orderId: 19, created: true });
  });
});
