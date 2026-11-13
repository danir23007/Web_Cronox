import { resolveWebPrice, validateWebOffer, webOfferStatus } from './web-offer';
import { OrdersService } from '../orders/orders.service';

describe('Oferta web', () => {
  const start = new Date('2026-11-12T10:00:00Z');
  const end = new Date('2026-11-12T11:00:00Z');
  const offer = {
    id: 'lot-one',
    webOfferPriceCents: 5200,
    webOfferPreviousCents: 6500,
    webOfferStartsAt: start,
    webOfferEndsAt: end,
    webOfferConfirmedAt: new Date('2026-11-11T00:00:00Z'),
  };
  const product = {
    price: 6500,
    isActive: true,
    activeLotId: 'lot-one',
    inventoryLots: [offer],
  };
  afterEach(() => jest.useRealTimers());
  it('uses the actual regular sizes when every active size overrides the base price', () => {
    const overrides = { ...product, price: 4000, variants: [{ price: 6500, isActive: true }] };
    expect(resolveWebPrice(overrides, undefined, start).effectivePrice).toBe(5200);
  });

  it.each([
    ['2026-11-12T09:59:59.999Z', 6500, 'SCHEDULED'],
    ['2026-11-12T10:00:00.000Z', 5200, 'ACTIVE'],
    ['2026-11-12T10:59:59.999Z', 5200, 'ACTIVE'],
    ['2026-11-12T11:00:00.000Z', 6500, 'ENDED'],
  ])('resolves exact server boundary %s', (instant, price, status) => {
    const now = new Date(instant);
    expect(resolveWebPrice(product, { price: null }, now).effectivePrice).toBe(
      price,
    );
    expect(webOfferStatus(offer, now)).toBe(status);
  });

  it('restores the size override after expiry and early disable, and excludes other/hidden editions', () => {
    expect(resolveWebPrice(product, { price: 7000 }, end).effectivePrice).toBe(
      7000,
    );
    expect(
      resolveWebPrice(
        {
          ...product,
          inventoryLots: [{ ...offer, webOfferDisabledAt: start }],
        },
        undefined,
        start,
      ).effectivePrice,
    ).toBe(6500);
    expect(
      resolveWebPrice({ ...product, activeLotId: 'lot-two' }, undefined, start)
        .effectivePrice,
    ).toBe(6500);
    expect(
      resolveWebPrice({ ...product, isActive: false }, undefined, start)
        .previousPrice,
    ).toBeNull();
  });

  it('names the size that is not discounted and rejects an incorrect shared reference', () => {
    expect(() =>
      validateWebOffer(offer, {
        price: 6500,
        variants: [{ size: 'M', price: 5000 }],
      }),
    ).toThrow('M');
    expect(() =>
      validateWebOffer(offer, {
        price: 6500,
        variants: [{ size: 'M' }, { size: 'L', price: 7000 }],
      }),
    ).toThrow('precios habituales distintos');
    expect(() =>
      validateWebOffer(
        { ...offer, webOfferConfirmedAt: null },
        { price: 6500, variants: [{ size: 'M' }] },
      ),
    ).toThrow('30 días');
    expect(() =>
      validateWebOffer(
        { ...offer, webOfferEndsAt: start },
        { price: 6500, variants: [{ size: 'M' }] },
      ),
    ).toThrow('posterior');
    expect(() =>
      validateWebOffer(offer, {
        price: 6500,
        variants: [{ size: 'M', price: 6500 }],
      }),
    ).not.toThrow();
  });

  it('uses the effective line price for totals and requires acceptance after each boundary', () => {
    jest.useFakeTimers().setSystemTime(start);
    const orders = Object.create(OrdersService.prototype) as any;
    const cart = {
      items: [
        {
          variantId: 1,
          qty: 1,
          lotAtAdd: 'lot-one',
          priceAtAdd: 6500,
          variant: { id: 1, price: null, isActive: true, stockQty: 5, product },
        },
      ],
    };
    expect(() => orders.assertCartEligibleForCheckout(cart)).toThrow(
      'Ha cambiado',
    );
    cart.items[0].priceAtAdd = 5200;
    expect(() => orders.assertCartEligibleForCheckout(cart)).not.toThrow();
    expect(orders.computeItemsTotalCents(cart)).toBe(5200);
    jest.setSystemTime(end);
    expect(() => orders.assertCartEligibleForCheckout(cart)).toThrow(
      'Ha cambiado',
    );
    expect(orders.computeItemsTotalCents(cart)).toBe(6500);
  });
});
