// [STRIPE] Pruebas unitarias para el wrapper de Stripe
import { BadRequestException } from '@nestjs/common';
import { StripeService } from './stripe.service';

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
});
