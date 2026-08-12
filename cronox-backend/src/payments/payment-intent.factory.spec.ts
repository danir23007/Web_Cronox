import { PaymentIntentFactory } from './payment-intent.factory';
import {
  CheckoutPaymentIntentCancelledException,
  CheckoutPaymentIntentConfigurationException,
} from './stripe.service';

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
    stripeAccountId: 'acct_test',
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
      recordCheckoutStripeAccount: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      getReusableCheckoutPaymentIntent: jest.fn().mockResolvedValue({
        id: 'pi_server_bound',
        clientSecret: 'secret_server_bound',
        stripeAccountId: 'acct_test',
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
    const browserRetry = await factory.createPaymentIntentForUser(1, {
      shippingMethod: 'EXPRESS',
    } as any);

    expect(result).toMatchObject({
      paymentIntentId: 'pi_server_bound',
      clientSecret: 'secret_server_bound',
      metadata: { checkoutSnapshotId: 'snap_1' },
    });
    expect(browserRetry).toMatchObject({
      paymentIntentId: 'pi_server_bound',
      clientSecret: 'secret_server_bound',
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
          stripeAccountId: 'acct_test',
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
        'acct_test',
      );
      expect(result).toMatchObject({ paymentIntentId: 'pi_new' });
    },
  );

  it('canonicalizes checkout addresses and passes España to the Stripe boundary adapter', async () => {
    const ordersService = {
      createCheckoutSnapshot: jest.fn().mockResolvedValue(baseSnapshot),
      claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
        id: 'pi_country',
        clientSecret: 'secret_country',
        stripeAccountId: 'acct_test',
      }),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    await factory.createPaymentIntentForUser(1, {
      shippingMethod: 'STANDARD',
      shippingAddress: {
        name: 'Daniel Rivas',
        line1: 'Calle Mayor 1',
        city: 'Madrid',
        postalCode: '28001',
        country: 'ES',
      },
    } as any);

    expect(ordersService.createCheckoutSnapshot).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        shippingAddress: expect.objectContaining({ country: 'España' }),
      }),
      expect.any(Object),
    );
    expect(stripeService.createPaymentIntentForCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingAddress: expect.objectContaining({ country: 'España' }),
      }),
    );
  });

  it('uses the same canonical country for guest checkout snapshots', async () => {
    const ordersService = {
      createCheckoutSnapshotForOwner: jest.fn().mockResolvedValue(baseSnapshot),
      claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
        id: 'pi_guest_country',
        clientSecret: 'secret_guest_country',
        stripeAccountId: 'acct_test',
      }),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );
    const owner = {
      anonymousId: 'opaque-guest-owner-123456',
      customerEmail: 'guest@example.test',
    };

    await factory.createPaymentIntentForOwner(owner, {
      shippingMethod: 'STANDARD',
      shippingAddress: {
        name: 'Guest Customer',
        line1: 'Calle Uno 1',
        city: 'Madrid',
        postalCode: '28001',
        country: 'Spain',
      },
    } as any);

    expect(ordersService.createCheckoutSnapshotForOwner).toHaveBeenCalledWith(
      owner,
      expect.objectContaining({
        shippingAddress: expect.objectContaining({ country: 'España' }),
      }),
      expect.any(Object),
    );
  });

  it('rejects an unsupported checkout country before snapshot persistence', async () => {
    const ordersService = { createCheckoutSnapshot: jest.fn() };
    const factory = new PaymentIntentFactory(ordersService as any, {} as any);

    await expect(
      factory.createPaymentIntentForUser(1, {
        shippingMethod: 'STANDARD',
        shippingAddress: { country: 'France' },
      } as any),
    ).rejects.toThrow('Solo se admite España como país o región.');
    expect(ordersService.createCheckoutSnapshot).not.toHaveBeenCalled();
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
        stripeAccountId: 'acct_test',
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
      'acct_test',
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
          stripeAccountId: 'acct_test',
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
    const stripeService = {
      cancelCheckoutPaymentIntent: jest.fn(),
      assertCheckoutPaymentIsNotConfirming: jest
        .fn()
        .mockResolvedValue(undefined),
    };
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

  it('reports confirmation pending instead of a temporary replacement conflict', async () => {
    const ordersService = {
      createCheckoutSnapshot: jest.fn().mockResolvedValue({
        ...baseSnapshot,
        paymentIntentId: 'pi_succeeded',
        status: 'REPLACEMENT_PENDING',
        replacementRequired: true,
      }),
      claimCheckoutSnapshotReplacement: jest.fn().mockResolvedValue(false),
    };
    const stripeService = {
      assertCheckoutPaymentIsNotConfirming: jest
        .fn()
        .mockRejectedValue(new Error('CHECKOUT_PAYMENT_CONFIRMATION_PENDING')),
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
    ).rejects.toThrow('CHECKOUT_PAYMENT_CONFIRMATION_PENDING');
    expect(
      stripeService.assertCheckoutPaymentIsNotConfirming,
    ).toHaveBeenCalledWith('pi_succeeded', 'snap_1');
  });

  it('replaces a live snapshot whose missing PaymentIntent passes every safety check', async () => {
    const staleSnapshot = {
      ...baseSnapshot,
      paymentIntentId: 'pi_missing',
      status: 'REPLACEMENT_PENDING',
      replacementRequired: true,
    };
    const ordersService = {
      createCheckoutSnapshot: jest
        .fn()
        .mockResolvedValueOnce(staleSnapshot)
        .mockResolvedValueOnce(baseSnapshot),
      claimCheckoutSnapshotReplacement: jest.fn().mockResolvedValue(false),
      claimUnavailableCheckoutPaymentRecovery: jest.fn().mockResolvedValue({
        claimed: true,
        token: 'recovery_token',
      }),
      finalizeUnavailableCheckoutPaymentRecovery: jest
        .fn()
        .mockResolvedValue({ released: true }),
      claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const missingError = Object.assign(new Error('missing'), {
      statusCode: 404,
      code: 'resource_missing',
    });
    const stripeService = {
      assertCheckoutPaymentIsNotConfirming: jest
        .fn()
        .mockRejectedValue(missingError),
      isMissingPaymentIntentError: jest.fn().mockReturnValue(true),
      proveMissingPaymentIntentCanBeRecovered: jest.fn().mockResolvedValue({
        safe: true,
        stripeAccountId: 'acct_test',
        reason: 'PROVEN_MISSING_WITHOUT_CHARGES',
      }),
      createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
        id: 'pi_fresh',
        clientSecret: 'secret_fresh',
        stripeAccountId: 'acct_test',
      }),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    await expect(
      factory.createPaymentIntentForUser(
        1,
        { shippingMethod: 'STANDARD' } as any,
        { id: 10, updatedAt: new Date() } as any,
      ),
    ).resolves.toMatchObject({
      paymentIntentId: 'pi_fresh',
      clientSecret: 'secret_fresh',
    });

    expect(
      ordersService.claimUnavailableCheckoutPaymentRecovery,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutSnapshotId: 'snap_1',
        paymentIntentId: 'pi_missing',
        stripeAccountId: 'acct_test',
      }),
    );
    expect(ordersService.createCheckoutSnapshot).toHaveBeenCalledTimes(2);
  });

  it('replaces a cancelled reusable PaymentIntent after database safety checks', async () => {
    const cancelledSnapshot = {
      ...baseSnapshot,
      paymentIntentId: 'pi_cancelled',
      status: 'PAYMENT_BOUND',
      reused: true,
    };
    const ordersService = {
      createCheckoutSnapshot: jest
        .fn()
        .mockResolvedValueOnce(cancelledSnapshot)
        .mockResolvedValueOnce(baseSnapshot),
      claimUnavailableCheckoutPaymentRecovery: jest.fn().mockResolvedValue({
        claimed: true,
        token: 'cancelled_recovery',
      }),
      finalizeUnavailableCheckoutPaymentRecovery: jest
        .fn()
        .mockResolvedValue({ released: true }),
      claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      getReusableCheckoutPaymentIntent: jest
        .fn()
        .mockRejectedValue(
          new CheckoutPaymentIntentCancelledException('acct_test'),
        ),
      createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
        id: 'pi_after_cancel',
        clientSecret: 'secret_after_cancel',
        stripeAccountId: 'acct_test',
      }),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    await expect(
      factory.createPaymentIntentForUser(
        1,
        { shippingMethod: 'STANDARD' } as any,
        { id: 10, updatedAt: new Date() } as any,
      ),
    ).resolves.toMatchObject({ paymentIntentId: 'pi_after_cancel' });
    expect(
      ordersService.claimUnavailableCheckoutPaymentRecovery,
    ).toHaveBeenCalled();
  });

  it('cancels and safely replaces a reusable intent with stale payment methods', async () => {
    const legacySnapshot = {
      ...baseSnapshot,
      paymentIntentId: 'pi_legacy_methods',
      status: 'PAYMENT_BOUND',
      reused: true,
    };
    const ordersService = {
      createCheckoutSnapshot: jest
        .fn()
        .mockResolvedValueOnce(legacySnapshot)
        .mockResolvedValueOnce(baseSnapshot),
      claimUnavailableCheckoutPaymentRecovery: jest.fn().mockResolvedValue({
        claimed: true,
        token: 'configuration_recovery',
      }),
      finalizeUnavailableCheckoutPaymentRecovery: jest
        .fn()
        .mockResolvedValue({ released: true }),
      claimCheckoutPaymentIntentCreation: jest.fn().mockResolvedValue(true),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      getReusableCheckoutPaymentIntent: jest
        .fn()
        .mockRejectedValue(
          new CheckoutPaymentIntentConfigurationException('acct_test'),
        ),
      cancelCheckoutPaymentIntent: jest.fn().mockResolvedValue(undefined),
      createPaymentIntentForCheckout: jest.fn().mockResolvedValue({
        id: 'pi_current_methods',
        clientSecret: 'secret_current_methods',
        stripeAccountId: 'acct_test',
      }),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    await expect(
      factory.createPaymentIntentForUser(
        1,
        { shippingMethod: 'STANDARD' } as any,
        { id: 10, updatedAt: new Date() } as any,
      ),
    ).resolves.toMatchObject({ paymentIntentId: 'pi_current_methods' });

    expect(stripeService.cancelCheckoutPaymentIntent).toHaveBeenCalledWith(
      'pi_legacy_methods',
      'snap_1',
    );
    expect(
      ordersService.claimUnavailableCheckoutPaymentRecovery,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutSnapshotId: 'snap_1',
        paymentIntentId: 'pi_legacy_methods',
        stripeAccountId: 'acct_test',
      }),
    );
    expect(
      ordersService.finalizeUnavailableCheckoutPaymentRecovery,
    ).toHaveBeenCalled();
  });

  it('allows only one concurrent request to create the chargeable PaymentIntent', async () => {
    let resolveStripeCreation!: (value: {
      id: string;
      clientSecret: string;
      stripeAccountId: string;
    }) => void;
    const stripeCreation = new Promise<{
      id: string;
      clientSecret: string;
      stripeAccountId: string;
    }>((resolve) => {
      resolveStripeCreation = resolve;
    });
    const ordersService = {
      createCheckoutSnapshot: jest.fn().mockResolvedValue(baseSnapshot),
      claimCheckoutPaymentIntentCreation: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
      bindStripePaymentIntent: jest.fn().mockResolvedValue(undefined),
    };
    const stripeService = {
      createPaymentIntentForCheckout: jest.fn().mockReturnValue(stripeCreation),
    };
    const factory = new PaymentIntentFactory(
      ordersService as any,
      stripeService as any,
    );

    const first = factory.createPaymentIntentForUser(1, {
      shippingMethod: 'STANDARD',
    } as any);
    await Promise.resolve();
    const second = factory.createPaymentIntentForUser(1, {
      shippingMethod: 'STANDARD',
    } as any);

    await expect(second).rejects.toThrow('CHECKOUT_PAYMENT_INTENT_IN_PROGRESS');
    resolveStripeCreation({
      id: 'pi_single',
      clientSecret: 'secret_single',
      stripeAccountId: 'acct_test',
    });
    await expect(first).resolves.toMatchObject({
      paymentIntentId: 'pi_single',
    });
    expect(stripeService.createPaymentIntentForCheckout).toHaveBeenCalledTimes(
      1,
    );
  });
});
