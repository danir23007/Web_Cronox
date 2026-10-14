import { BadRequestException } from '@nestjs/common';
import { CheckoutSummaryController } from './checkout-summary.controller';

describe('Wallet shipping quotes', () => {
  const cart = { id: 5, items: [{ variantId: 1, qty: 1 }] };
  const orders = { getCheckoutSummary: jest.fn() };
  const carts = { getCheckoutCartForRequest: jest.fn().mockResolvedValue(cart) };
  const controller = new CheckoutSummaryController(orders as any, carts as any);
  beforeEach(() => jest.clearAllMocks());

  it('uses the owned cart and server totals without reserving stock for a redacted address', async () => {
    orders.getCheckoutSummary.mockResolvedValue({ totals: { totalCents: 1495 }, selectedShippingMethod: { code: 'EXPRESS' } });
    const req = { cookies: { cartId: 'owned' } } as any;
    await expect(controller.getExpressQuote(req, 'ES', undefined, 'EXPRESS', 'SAVE')).resolves.toEqual(expect.objectContaining({ totals: { totalCents: 1495 } }));
    expect(carts.getCheckoutCartForRequest).toHaveBeenCalledWith(req);
    expect(orders.getCheckoutSummary).toHaveBeenCalledWith(cart, expect.objectContaining({ shippingMethod: 'EXPRESS', promoCode: 'SAVE' }));
  });

  it.each([['US', '10001'], ['BR', '04538-133'], ['', undefined], ['ES', 'invalid']])('rejects unsupported region/postcode %s %s', async (country, postal) => {
    await expect(controller.getExpressQuote({} as any, country!, postal)).rejects.toBeInstanceOf(BadRequestException);
    expect(orders.getCheckoutSummary).not.toHaveBeenCalled();
  });

  it('propagates server stock rejection to the wallet quote', async () => {
    orders.getCheckoutSummary.mockRejectedValueOnce(new BadRequestException('INSUFFICIENT_STOCK'));
    await expect(controller.getExpressQuote({} as any, 'ES', '28001', 'STANDARD')).rejects.toThrow('INSUFFICIENT_STOCK');
  });

  it.each([undefined, 'express', 'UNKNOWN'])('rejects an unknown rate identifier %s without silently choosing another method', async method => {
    await expect(controller.getExpressQuote({} as any, 'ES', '28001', method)).rejects.toThrow('CHECKOUT_SHIPPING_METHOD_UNAVAILABLE');
    expect(orders.getCheckoutSummary).not.toHaveBeenCalled();
  });

  it('rejects a formerly available rate instead of returning a fallback total', async () => {
    orders.getCheckoutSummary.mockResolvedValue({ selectedShippingMethod: { code: 'STANDARD' } });
    await expect(controller.getExpressQuote({} as any, 'ES', '28001', 'EXPRESS')).rejects.toThrow('CHECKOUT_SHIPPING_METHOD_UNAVAILABLE');
  });
});
