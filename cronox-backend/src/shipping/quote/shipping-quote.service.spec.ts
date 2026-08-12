import { BadRequestException } from '@nestjs/common';
import { ShippingQuoteService } from './shipping-quote.service';

describe('ShippingQuoteService country normalization', () => {
  const service = new ShippingQuoteService();

  it.each(['España', 'ES', 'Spain'])(
    'returns the canonical Spain quote for %s',
    (country) => {
      expect(service.findBestQuote(country)).toEqual(
        expect.objectContaining({ country: 'España', quote: 5.5 }),
      );
    },
  );

  it('rejects unsupported quote countries', () => {
    expect(() => service.findBestQuote('France')).toThrow(BadRequestException);
  });
});
