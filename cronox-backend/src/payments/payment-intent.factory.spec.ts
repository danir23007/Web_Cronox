import { PaymentIntentFactory } from './payment-intent.factory';

describe('PaymentIntentFactory', () => {
  const baseSnapshot = {
    checkoutSnapshotId: 'snap_1',
    cartId: 10,
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
    replacementRequired: false,
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

    const result = await factory.createPaymentIntentForUser(1, {
      shippingMethod: 'EXPRESS',
      paymentIntentId: 'pi_client_supplied',
    } as any);

    expect(result).toMatchObject({
      paymentIntentId: 'pi_server_bound',
      clientSecret: 'secret_server_bound',
      metadata: { checkoutSnapshotId: 'snap_1' },
    });
    expect(stripeService.getReusableCheckoutPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ paymentIntentId: 'pi_server_bound' }),
    );
    expect(stripeService.createPaymentIntentForCheckout).not.toHaveBeenCalled();
    expect(
      ordersService.claimCheckoutPaymentIntentCreation,
    ).not.toHaveBeenCalled();
  });

  it.each(['STANDARD', 'EXPRESS'])(
    'creates a new %s checkout from backend-owned totals',
    async (shippingMethod) => {
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

      const result = await factory.createPaymentIntentForUser(1, {
        shippingMethod,
      } as any);

      expect(
        ordersService.claimCheckoutPaymentIntentCreation,
      ).toHaveBeenCalledWith('snap_1');
      expect(stripeService.createPaymentIntentForCheckout).toHaveBeenCalledWith(
        {
          checkoutSnapshotId: 'snap_1',
          amount: 10495,
          currency: 'EUR',
        },
      );
      expect(ordersService.bindStripePaymentIntent).toHaveBeenCalledWith(
        'snap_1',
        'pi_new',
      );
      expect(result).toMatchObject({ paymentIntentId: 'pi_new' });
    },
  );

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

    const result = await factory.createPaymentIntentForUser(1, {
      shippingMethod: 'EXPRESS',
    } as any);

    expect(
      ordersService.claimCheckoutPaymentIntentCreation,
    ).toHaveBeenCalledWith('snap_1');
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

  it.each([
    ['STANDARD', 'EXPRESS', 'standard', 'express', 10995],
    ['EXPRESS', 'STANDARD', 'express', 'standard', 10495],
  ])(
    'securely replaces %s shipping with %s using only the server snapshot',
    async (_from, shippingMethod, previousSuffix, nextSuffix, amountCents) => {
      const replacement = {
        ...baseSnapshot,
        checkoutSnapshotId: `snap_${previousSuffix}`,
        paymentIntentId: `pi_${previousSuffix}`,
        status: 'PAYMENT_BOUND',
        replacementRequired: true,
      };
      const nextSnapshot = {
        ...baseSnapshot,
        checkoutSnapshotId: `snap_${nextSuffix}`,
        amountCents,
      };
      const ordersService = {
        createCheckoutSnapshot: jest
          .fn()
          .mockResolvedValueOnce(replacement)
          .mockResolvedValueOnce(nextSnapshot),
        claimCheckoutSnapshotReplacement: jest.fn().mockResolvedValue(true),
        releaseCheckoutSnapshot: jest.fn().mockResolvedValue(undefined),
        claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
        bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
      };
      const stripeService = {
        cancelCheckoutPaymentIntent: jest.fn().mockResolvedValue(undefined),
        createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
          id: `pi_${nextSuffix}`,
          clientSecret: `secret_${nextSuffix}`,
        }),
      };
      const factory = new PaymentIntentFactory(
        ordersService as any,
        stripeService as any,
      );

      const result = await factory.createPaymentIntentForUser(
        1,
        {
          shippingMethod,
          paymentIntentId: 'pi_attacker_supplied',
        } as any,
        { id: 10 } as any,
      );

      expect(
        ordersService.claimCheckoutSnapshotReplacement,
      ).toHaveBeenCalledWith(1, 10, `snap_${previousSuffix}`);
      expect(stripeService.cancelCheckoutPaymentIntent).toHaveBeenCalledWith(
        `pi_${previousSuffix}`,
        `snap_${previousSuffix}`,
      );
      expect(ordersService.releaseCheckoutSnapshot).toHaveBeenCalledWith(
        `snap_${previousSuffix}`,
        'REPLACED',
        `pi_${previousSuffix}`,
      );
      expect(result).toMatchObject({
        paymentIntentId: `pi_${nextSuffix}`,
        clientSecret: `secret_${nextSuffix}`,
      });
      expect(
        stripeService.cancelCheckoutPaymentIntent,
      ).not.toHaveBeenCalledWith('pi_attacker_supplied', expect.anything());
    },
  );

  it.each(['processing', 'succeeded'])(
    'fails closed when the previous PaymentIntent is %s',
    async (status) => {
      const ordersService = {
        createCheckoutSnapshot: jest.fn().mockResolvedValue({
          ...baseSnapshot,
          paymentIntentId: 'pi_bound',
          replacementRequired: true,
        }),
        claimCheckoutSnapshotReplacement: jest.fn().mockResolvedValue(true),
        releaseCheckoutSnapshot: jest.fn(),
      };
      const stripeService = {
        cancelCheckoutPaymentIntent: jest
          .fn()
          .mockRejectedValue(new Error(`STRIPE_${status.toUpperCase()}`)),
      };
      const factory = new PaymentIntentFactory(
        ordersService as any,
        stripeService as any,
      );

      await expect(
        factory.createPaymentIntentForUser(
          1,
          { shippingMethod: 'EXPRESS' } as any,
          { id: 10 } as any,
        ),
      ).rejects.toThrow(`STRIPE_${status.toUpperCase()}`);

      expect(ordersService.releaseCheckoutSnapshot).not.toHaveBeenCalled();
      expect(ordersService.createCheckoutSnapshot).toHaveBeenCalledTimes(1);
    },
  );

  it('does not cancel anything when another request or foreign owner holds the replacement claim', async () => {
    const ordersService = {
      createCheckoutSnapshot: jest.fn().mockResolvedValue({
        ...baseSnapshot,
        paymentIntentId: 'pi_server_owned',
        replacementRequired: true,
      }),
      claimCheckoutSnapshotReplacement: jest.fn().mockResolvedValue(false),
      releaseCheckoutSnapshot: jest.fn(),
    };
    const stripeService = { cancelCheckoutPaymentIntent: jest.fn() };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    await expect(
      factory.createPaymentIntentForUser(
        99,
        { shippingMethod: 'STANDARD' } as any,
        { id: 999 } as any,
      ),
    ).rejects.toThrow('CHECKOUT_REPLACEMENT_IN_PROGRESS');

    expect(stripeService.cancelCheckoutPaymentIntent).not.toHaveBeenCalled();
    expect(ordersService.releaseCheckoutSnapshot).not.toHaveBeenCalled();
  });
});
