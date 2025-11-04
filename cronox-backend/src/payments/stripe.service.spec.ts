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
    expect(() => service.constructEventFromPayload(undefined, Buffer.from(''))).toThrow(
      BadRequestException,
    );
  });

  it('usa el SDK de Stripe para validar la firma', () => {
    const mockEvent = { type: 'test.event' } as any;
    const stripeInstance = (service as any).stripe as import('stripe');
    const spy = jest
      .spyOn(stripeInstance.webhooks, 'constructEvent')
      .mockReturnValue(mockEvent);

    const result = service.constructEventFromPayload('sig', Buffer.from('payload'));

    expect(spy).toHaveBeenCalledWith(Buffer.from('payload'), 'sig', 'whsec_dummy');
    expect(result).toBe(mockEvent);
  });
});
