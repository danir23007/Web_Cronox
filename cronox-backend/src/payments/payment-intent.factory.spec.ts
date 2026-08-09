import { PaymentIntentFactory } from './payment-intent.factory';

describe('PaymentIntentFactory', () => {
  const baseSnapshot = {
    checkoutSnapshotId: 'snap_1',
    amountCents: 10495,
    currency: 'EUR',
    summary: {},
    lineItems: [],
    shippingMethod: {},
    totals: {},
    paymentIntentId: null as string | null,
    status: 'RESERVED',
    expiresAt: new Date(Date.now() + 60_000),
    reused: false,
    expired: false,
  };

  it('reuses the server-bound PaymentIntent instead of honoring a client ID', async () => {
    const ordersService = {
      createCheckoutSnapshot: jest.fn().mockResolvedValue({
        ...baseSnapshot,
        paymentIntentId: 'pi_server_bound',
        status: 'PAYMENT_BOUND',
        reused: true,
      }),
      claimCheckoutPaymentIntentCreation: jest.fn(),
    };
    const stripeService = {
      getReusableCheckoutPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_server_bound',
        clientSecret: 'secret_server_bound',
      }),
      createPaymentIntentForCheckout: jest.fn(),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    const result = await factory.createPaymentIntentForUser(
      1,
      {
        shippingMethod: 'EXPRESS',
        paymentIntentId: 'pi_client_supplied',
      } as any,
    );

    expect(result).toMatchObject({
      paymentIntentId: 'pi_server_bound',
      clientSecret: 'secret_server_bound',
      metadata: { checkoutSnapshotId: 'snap_1' },
    });
    expect(stripeService.getReusableCheckoutPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_server_bound' }),
    );
    expect(stripeService.createPaymentIntentForCheckout).not.toHaveBeenCalled();
    expect(ordersService.claimCheckoutPaymentIntentCreation).not.toHaveBeenCalled();
  });

  it('claims one snapshot before creating and binding a new PaymentIntent', async () => {
    const ordersService = {
      createCheckoutSnapshot: jest.fn().mockResolvedValue(baseSnapshot),
      claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
        id: 'pi_new',
        clientSecret: 'secret_new',
      }),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    const result = await factory.createPaymentIntentForUser(
      1,
      { shippingMethod: 'EXPRESS' } as any,
    );

    expect(ordersService.claimCheckoutPaymentIntentCreation).toHaveBeenCalledWith(
      'snap_1',
    );
    expect(stripeService.createPaymentIntentForCheckout).toHaveBeenCalledWith({
      checkoutSnapshotId: 'snap_1',
      amount: 10495,
      currency: 'EUR',
    });
    expect(ordersService.bindStripePaymentIntent).toHaveBeenCalledWith(
      'snap_1',
      'pi_new',
    );
    expect(result).toMatchObject({ paymentIntentId: 'pi_new' });
  });

  it('recovers a stale creation-in-progress snapshot with Stripe idempotency', async () => {
    const ordersService = {
      createCheckoutSnapshot: jest.fn().mockResolvedValue({
        ...baseSnapshot,
        status: 'PAYMENT_INTENT_CREATING',
      }),
      claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
        id: 'pi_recovered',
        clientSecret: 'secret_recovered',
      }),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    const result = await factory.createPaymentIntentForUser(
      1,
      { shippingMethod: 'EXPRESS' } as any,
    );

    expect(ordersService.claimCheckoutPaymentIntentCreation).toHaveBeenCalledWith(
      'snap_1',
    );
    expect(stripeService.createPaymentIntentForCheckout).toHaveBeenCalledWith({
      checkoutSnapshotId: 'snap_1',
      amount: 10495,
      currency: 'EUR',
    });
    expect(ordersService.bindStripePaymentIntent).toHaveBeenCalledWith(
      'snap_1',
      'pi_recovered',
    );
    expect(result).toMatchObject({ paymentIntentId: 'pi_recovered' });
  });
});
