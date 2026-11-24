import { abandonmentStart, recordCartActivity } from './cart-abandonment-state';
import { abandonmentWorkerEnabled, purchasableReminderItems } from './cart-abandonment.service';
import { CartController } from './cart.controller';
import { EmailService } from '../email/email.service';
import { structuredDocumentForPurpose } from '../email/managed/mail-template-documents';
import { renderMail } from '../email/managed/mail-renderer';
import { composeGlobalMailFooter } from '../email/mail-global-footer';

describe('abandoned cart eligibility and delivery boundaries', () => {
  const environment = { ...process.env };
  beforeEach(() => {
    jest.useFakeTimers(); jest.setSystemTime(new Date('2030-01-01T23:00:00Z'));
    process.env.CART_ABANDONMENT_START_AT = '2030-01-01T00:00:00Z';
    process.env.CART_ABANDONMENT_ENABLED = 'true'; process.env.BACKGROUND_JOBS_ENABLED = 'true';
  });
  afterEach(() => { jest.useRealTimers(); process.env = { ...environment }; });

  const fixture = () => ({ items: [{ qty: 2, lotAtAdd: 'current', variant: {
    isActive: true, stockQty: 3, size: 'M', price: 4500, product: {
      name: 'Camiseta', currency: 'EUR', price: 4900, isActive: true, activeLotId: 'current',
      images: [{ url: 'https://example.test/actual.png' }], inventoryLots: [{ id: 'current',
        webOfferPriceCents: 3900, webOfferPreviousCents: 4500, webOfferConfirmedAt: new Date('2029-01-01'),
        webOfferStartsAt: new Date('2030-01-01'), webOfferEndsAt: new Date('2030-01-02') }],
    },
  } }] }) as any;

  it('requires explicit activation and an unambiguous cutoff', () => {
    expect(abandonmentWorkerEnabled()).toBe(true);
    delete process.env.CART_ABANDONMENT_ENABLED; expect(abandonmentWorkerEnabled()).toBe(false);
    process.env.CART_ABANDONMENT_START_AT = '01/01/2030'; expect(abandonmentStart()).toBeNull();
    process.env.CART_ABANDONMENT_ENABLED = 'true'; expect(abandonmentWorkerEnabled()).toBe(false);
  });
  it('does not even create historical episodes without a cutoff', async () => {
    delete process.env.CART_ABANDONMENT_START_AT;
    const tx = { $executeRaw: jest.fn() };
    await recordCartActivity(tx as any, 1); expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
  it('resolves current offers at a controlled time and caps quantity at current stock', () => {
    const cart = fixture(); cart.items[0].variant.stockQty = 1;
    expect(purchasableReminderItems(cart)[0]).toMatchObject({ quantity: 1, unitPriceFormatted: '39,00 €' });
    jest.setSystemTime(new Date('2030-01-02T00:00:00Z'));
    expect(purchasableReminderItems(cart)[0].unitPriceFormatted).toBe('45,00 €');
  });
  it.each(['edition', 'stock', 'inactive', 'currency'])('excludes unpurchasable %s', reason => {
    const cart = fixture(), v = cart.items[0].variant;
    if (reason === 'edition') cart.items[0].lotAtAdd = 'previous';
    if (reason === 'stock') v.stockQty = 0;
    if (reason === 'inactive') v.product.isActive = false;
    if (reason === 'currency') v.product.currency = 'USD';
    expect(purchasableReminderItems(cart)).toEqual([]);
  });
  it('requires authentication and rejects administrators before recovery or activity', () => {
    const service = { recover: jest.fn(), activity: jest.fn() };
    const controller = new CartController({} as any, undefined, service as any);
    for (const user of [undefined, { id: 1, role: 'ADMIN' }, { id: 1, role: 'SUPERADMIN' }]) {
      expect(() => controller.recover({ user } as any, 'episode')).toThrow();
      expect(() => controller.activity({ user } as any)).toThrow();
    }
    expect(service.recover).not.toHaveBeenCalled(); expect(service.activity).not.toHaveBeenCalled();
  });
  it('publishes through the existing renderer and requires products, recovery and unsubscribe', () => {
    const document = structuredDocumentForPurpose('CART_ABANDONED')!;
    const data = { items: purchasableReminderItems(fixture()), actionUrl: 'https://example.test/cart', unsubscribeUrl: 'https://example.test/baja' };
    const signature = { blocks: [{ type: 'text', text: 'Firma compartida CRONOX' }] };
    const rendered = renderMail(document, 'Tu carrito', '', 'CART_ABANDONED', data, signature, true);
    expect(rendered.html).toContain('VOLVER A MI CESTA'); expect(rendered.html).not.toContain(data.unsubscribeUrl);
    expect(rendered.html).not.toContain('Firma compartida CRONOX'); expect(rendered.html).toContain('https://example.test/actual.png');
    expect(rendered.text).toContain('Camiseta');
    expect(() => renderMail({ blocks: [{ type: 'text', text: 'Sin datos' }] }, 'Carrito', '', 'CART_ABANDONED', data, undefined, true)).toThrow();
  });
  it('keeps ambiguous SMTP errors distinct from safe rejection and quota waiting', async () => {
    const sendMail = jest.fn(), email = new EmailService({ sendMail } as any);
    const payload = { html: '<p>Fixture</p>', text: 'Fixture', subject: 'Fixture' };
    const uncertain = Object.assign(Error('response lost'), { deliveryUnknown: true });
    sendMail.mockRejectedValueOnce(uncertain);
    await expect(email.sendAbandonedCart('fixture@example.test', payload, Date.now() + 8000)).rejects.toMatchObject({ deliveryUnknown: true });
    expect((uncertain as any).reminderRetrySafe).toBeUndefined();
    sendMail.mockRejectedValueOnce(Error('rejected before DATA'));
    await expect(email.sendAbandonedCart('fixture@example.test', payload, Date.now() + 8000)).rejects.toMatchObject({ reminderRetrySafe: true });
    expect(sendMail.mock.calls[0][0]).toBe('NOREPLY');
    expect(sendMail.mock.calls[0][2]).toBe('CART_ABANDONED');
  });
  it('validates decoded recovery queries and product names containing HTML entities', async () => {
    const document = structuredDocumentForPurpose('CART_ABANDONED')!;
    const items = purchasableReminderItems(fixture()); items[0].name = "Camiseta d'Alex & CRONOX";
    const data = { items, circleLevel: 1, actionUrl: 'https://example.test/cart.html?recover=opaque&view=cart', unsubscribeUrl: 'https://example.test/baja/token' };
    const publication = renderMail(document, 'Tu carrito', '', 'CART_ABANDONED', data, undefined, true);
    const email = new EmailService({} as any, { published: jest.fn().mockResolvedValue(publication) } as any);
    await expect(email.prepareAbandonedCart('fixture@example.test', data)).resolves.toEqual(publication);
  });
  it('prepares a published cart after the shared footer replaces its legacy opt-out link', async () => {
    const data = { items: purchasableReminderItems(fixture()), circleLevel: 1,
      actionUrl: 'https://example.test/cesta?recover=opaque', unsubscribeUrl: 'https://example.test/api/mailbox-unsubscribe/local-fixture' };
    const rendered = renderMail(structuredDocumentForPurpose('CART_ABANDONED')!, 'Tu carrito', '', 'CART_ABANDONED', data, undefined, true);
    const publication = { ...rendered, ...composeGlobalMailFooter(rendered.html, rendered.text, { preferenceUrl: 'https://example.test/preferencias-correo' }) };
    expect(publication.html).not.toContain(data.unsubscribeUrl);
    expect(publication.text).not.toContain(data.unsubscribeUrl);
    expect(publication.html).toContain('Actualiza tus preferencias');
    const email = new EmailService({} as any, { published: jest.fn().mockResolvedValue(publication) } as any);
    await expect(email.prepareAbandonedCart('fixture@example.test', data)).resolves.toEqual(publication);
  });
});
