// [STRIPE] Pruebas unitarias para el wrapper de Stripe
import { BadRequestException } from '@nestjs/common';
import {
  CHECKOUT_PAYMENT_METHOD_TYPES,
  CheckoutPaymentIntentConfigurationException,
  StripeService,
} from './stripe.service';

describe('StripeService', () => {
  let service: StripeService;
  let config: { get: jest.Mock };

  beforeEach(() => {
    config = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'STRIPE_SECRET_KEY':
            return 'sk_test_dummy';
          case 'STRIPE_WEBHOOK_SECRET':
            return 'whsec_dummy';
          case 'STRIPE_PAYMENT_DESCRIPTION':
            return 'CRONOX Order';
          default:
            return undefined;
        }
      }),
    };

    service = new StripeService(config as any);
  });

  it('lanza BadRequestException si no hay firma en el webhook', () => {
    expect(() =>
      service.constructEventFromPayload(undefined, Buffer.from('')),
    ).toThrow(BadRequestException);
  });

  it('usa el SDK de Stripe para validar la firma', () => {
    const mockEvent = { type: 'test.event' } as any;
    const stripeInstance = (service as any).stripe as import('stripe');
    const spy = jest
      .spyOn(stripeInstance.webhooks, 'constructEvent')
      .mockReturnValue(mockEvent);

    const result = service.constructEventFromPayload(
      'sig',
      Buffer.from('payload'),
    );

    expect(spy).toHaveBeenCalledWith(
      Buffer.from('payload'),
      'sig',
      'whsec_dummy',
    );
    expect(result).toBe(mockEvent);
  });

  it('cancels only an unconfirmed PaymentIntent bound to the expected snapshot', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest.spyOn(stripeInstance.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_owned',
      status: 'requires_payment_method',
      amount: 3990,
      currency: 'eur',
      metadata: { checkoutSnapshotId: 'snap_owned' },
    });
    const cancel = jest
      .spyOn(stripeInstance.paymentIntents, 'cancel')
      .mockResolvedValue({ status: 'canceled' });

    await expect(
      service.cancelCheckoutPaymentIntent('pi_owned', 'snap_owned'),
    ).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledWith('pi_owned');
  });

  it('refuses to cancel a foreign PaymentIntent', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest.spyOn(stripeInstance.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_foreign',
      status: 'requires_payment_method',
      amount: 3990,
      currency: 'eur',
      metadata: { checkoutSnapshotId: 'snap_other_user' },
    });
    const cancel = jest.spyOn(stripeInstance.paymentIntents, 'cancel');

    await expect(
      service.cancelCheckoutPaymentIntent('pi_foreign', 'snap_owned'),
    ).rejects.toThrow('STRIPE_PAYMENT_INTENT_SNAPSHOT_MISMATCH');
    expect(cancel).not.toHaveBeenCalled();
  });

  it.each(['processing', 'succeeded'])(
    'refuses to cancel a %s PaymentIntent',
    async (status) => {
      const stripeInstance = (service as any).stripe as any;
      jest.spyOn(stripeInstance.paymentIntents, 'retrieve').mockResolvedValue({
        id: 'pi_terminal',
        status,
        amount: 3990,
        currency: 'eur',
        metadata: { checkoutSnapshotId: 'snap_owned' },
      });
      const cancel = jest.spyOn(stripeInstance.paymentIntents, 'cancel');

      await expect(
        service.cancelCheckoutPaymentIntent('pi_terminal', 'snap_owned'),
      ).rejects.toThrow('CHECKOUT_PAYMENT_CONFIRMATION_PENDING');
      expect(cancel).not.toHaveBeenCalled();
    },
  );

  it('classifies a server-bound succeeded intent without trying to cancel it', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest.spyOn(stripeInstance.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_succeeded',
      status: 'succeeded',
      amount: 3790,
      currency: 'eur',
      metadata: { checkoutSnapshotId: 'snap_owned' },
    });

    await expect(
      service.assertCheckoutPaymentIsNotConfirming(
        'pi_succeeded',
        'snap_owned',
      ),
    ).rejects.toThrow('CHECKOUT_PAYMENT_CONFIRMATION_PENDING');
  });

  it('recovers only Stripe resource_missing errors in test mode', () => {
    expect(
      service.isRecoverableTestModeMissingPaymentIntent({
        statusCode: 404,
        code: 'resource_missing',
      }),
    ).toBe(true);
    expect(
      service.isRecoverableTestModeMissingPaymentIntent({
        statusCode: 404,
        code: 'different_error',
      }),
    ).toBe(false);
  });

  it('keeps missing PaymentIntents fail-closed in live mode', () => {
    config.get.mockImplementation((key: string) =>
      key === 'STRIPE_SECRET_KEY' ? 'sk_live_dummy' : undefined,
    );
    const liveService = new StripeService(config as any);

    expect(
      liveService.isRecoverableTestModeMissingPaymentIntent({
        statusCode: 404,
        code: 'resource_missing',
      }),
    ).toBe(false);
  });

  it('proves a missing test PaymentIntent has no charge in the current account', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest
      .spyOn(stripeInstance.accounts, 'retrieve')
      .mockResolvedValue({ id: 'acct_test' });
    jest.spyOn(stripeInstance.charges, 'list').mockResolvedValue({ data: [] });

    await expect(
      service.proveMissingPaymentIntentCanBeRecovered({
        paymentIntentId: 'pi_missing',
        expectedStripeAccountId: null,
      }),
    ).resolves.toEqual({
      safe: true,
      stripeAccountId: 'acct_test',
      reason: 'PROVEN_MISSING_WITHOUT_CHARGES',
    });
  });

  it('proves live recovery only for the persisted Stripe account and no charges', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'STRIPE_SECRET_KEY' ? 'sk_live_dummy' : undefined,
    );
    const liveService = new StripeService(config as any);
    const stripeInstance = (liveService as any).stripe as any;
    jest
      .spyOn(stripeInstance.accounts, 'retrieve')
      .mockResolvedValue({ id: 'acct_live' });
    jest.spyOn(stripeInstance.charges, 'list').mockResolvedValue({ data: [] });

    await expect(
      liveService.proveMissingPaymentIntentCanBeRecovered({
        paymentIntentId: 'pi_missing_live',
        expectedStripeAccountId: 'acct_live',
      }),
    ).resolves.toMatchObject({
      safe: true,
      stripeAccountId: 'acct_live',
    });
    await expect(
      liveService.proveMissingPaymentIntentCanBeRecovered({
        paymentIntentId: 'pi_legacy_live',
        expectedStripeAccountId: null,
      }),
    ).resolves.toEqual({ safe: false, reason: 'STRIPE_ACCOUNT_UNKNOWN' });
  });

  it('blocks missing-intent recovery when Stripe reports an existing charge', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest
      .spyOn(stripeInstance.accounts, 'retrieve')
      .mockResolvedValue({ id: 'acct_test' });
    jest
      .spyOn(stripeInstance.charges, 'list')
      .mockResolvedValue({ data: [{ id: 'ch_existing' }] });

    await expect(
      service.proveMissingPaymentIntentCanBeRecovered({
        paymentIntentId: 'pi_missing',
        expectedStripeAccountId: 'acct_test',
      }),
    ).resolves.toEqual({ safe: false, reason: 'STRIPE_CHARGE_EXISTS' });
  });

  it('uses the snapshot ID as the deterministic PaymentIntent idempotency key', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest
      .spyOn(stripeInstance.accounts, 'retrieve')
      .mockResolvedValue({ id: 'acct_test' });
    const create = jest
      .spyOn(stripeInstance.paymentIntents, 'create')
      .mockResolvedValue({ id: 'pi_same', client_secret: 'secret_same' });

    const args = {
      checkoutSnapshotId: 'snap_idempotent',
      amount: 3990,
      currency: 'EUR',
    };
    await service.createPaymentIntentForCheckout(args);
    await service.createPaymentIntentForCheckout(args);

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        payment_method_types: ['card', 'klarna', 'amazon_pay', 'paypal'],
        metadata: expect.objectContaining({
          checkoutSnapshotId: 'snap_idempotent',
          checkoutPaymentConfiguration: 'cronox_checkout_v3',
        }),
      }),
    );
    expect(create.mock.calls[0][0]).not.toHaveProperty(
      'automatic_payment_methods',
    );
    expect(CHECKOUT_PAYMENT_METHOD_TYPES).not.toContain('bancontact');
    expect(CHECKOUT_PAYMENT_METHOD_TYPES).not.toContain('eps');
    expect(CHECKOUT_PAYMENT_METHOD_TYPES).toContain('paypal');
    expect(create.mock.calls[0][1]).toEqual({
      idempotencyKey: 'checkout:snap_idempotent',
    });
    expect(create.mock.calls[1][1]).toEqual(create.mock.calls[0][1]);
  });

  it('maps the internal España country to ISO ES in the Stripe request', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest
      .spyOn(stripeInstance.accounts, 'retrieve')
      .mockResolvedValue({ id: 'acct_test' });
    const create = jest
      .spyOn(stripeInstance.paymentIntents, 'create')
      .mockResolvedValue({ id: 'pi_country', client_secret: 'secret_country' });

    await service.createPaymentIntentForCheckout({
      checkoutSnapshotId: 'snap_country',
      amount: 4895,
      currency: 'EUR',
      shippingAddress: {
        name: 'Daniel Rivas',
        line1: 'Calle Mayor 1',
        city: 'Madrid',
        postalCode: '28001',
        country: 'España',
      },
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        shipping: expect.objectContaining({
          name: 'Daniel Rivas',
          address: expect.objectContaining({
            country: 'ES',
            postal_code: '28001',
          }),
        }),
      }),
      expect.any(Object),
    );
    expect(create.mock.calls[0][0].shipping?.address?.country).not.toBe(
      'España',
    );
  });

  it('reuses only an intent with the current Card, Klarna, Amazon Pay and PayPal configuration', async () => {
    const stripeInstance = (service as any).stripe as any;
    jest
      .spyOn(stripeInstance.accounts, 'retrieve')
      .mockResolvedValue({ id: 'acct_test' });
    jest.spyOn(stripeInstance.paymentIntents, 'retrieve').mockResolvedValue({
      id: 'pi_current',
      status: 'requires_payment_method',
      amount: 3990,
      currency: 'eur',
      client_secret: 'secret_current',
      metadata: {
        checkoutSnapshotId: 'snap_current',
        checkoutPaymentConfiguration: 'cronox_checkout_v3',
      },
      payment_method_types: ['paypal', 'amazon_pay', 'card', 'klarna'],
    });

    await expect(
      service.getReusableCheckoutPaymentIntent({
        paymentIntentId: 'pi_current',
        checkoutSnapshotId: 'snap_current',
        amount: 3990,
        currency: 'EUR',
      }),
    ).resolves.toEqual({
      id: 'pi_current',
      clientSecret: 'secret_current',
      stripeAccountId: 'acct_test',
    });
  });

  it.each([
    [undefined, ['card']],
    ['cronox_checkout_v2', ['card', 'klarna', 'amazon_pay']],
    [
      'cronox_checkout_v3',
      ['card', 'klarna', 'amazon_pay', 'paypal', 'bancontact'],
    ],
    ['cronox_checkout_v3', ['card', 'klarna', 'amazon_pay', 'paypal', 'eps']],
  ])(
    'forces safe replacement of a stale or over-broad checkout configuration',
    async (configuration, paymentMethodTypes) => {
      const stripeInstance = (service as any).stripe as any;
      jest
        .spyOn(stripeInstance.accounts, 'retrieve')
        .mockResolvedValue({ id: 'acct_test' });
      jest.spyOn(stripeInstance.paymentIntents, 'retrieve').mockResolvedValue({
        id: 'pi_legacy',
        status: 'requires_payment_method',
        amount: 3990,
        currency: 'eur',
        client_secret: 'secret_legacy',
        metadata: {
          checkoutSnapshotId: 'snap_legacy',
          ...(configuration
            ? { checkoutPaymentConfiguration: configuration }
            : {}),
        },
        payment_method_types: paymentMethodTypes,
      });

      await expect(
        service.getReusableCheckoutPaymentIntent({
          paymentIntentId: 'pi_legacy',
          checkoutSnapshotId: 'snap_legacy',
          amount: 3990,
          currency: 'EUR',
        }),
      ).rejects.toBeInstanceOf(CheckoutPaymentIntentConfigurationException);
    },
  );
});
