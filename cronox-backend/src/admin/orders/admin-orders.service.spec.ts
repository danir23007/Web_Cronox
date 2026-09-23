import { AdminOrdersService } from './admin-orders.service';
import { OrderStatus } from '@prisma/client';

describe('AdminOrdersService CSV export', () => {
  const service = new AdminOrdersService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('neutralizes spreadsheet formulas before CSV quoting', () => {
    const csv = (service as any).stringifyCsv([
      ['carrier', 'tracking'],
      ['=HYPERLINK("https://attacker.example")', '\t+SUM(1,1)'],
    ]);

    expect(csv).toContain(`"'=HYPERLINK(""https://attacker.example"")"`);
    expect(csv).toContain(`"'\t+SUM(1,1)"`);
  });
});

describe('AdminOrdersService order detail', () => {
  const decimal = (value: string) => ({ toFixed: () => value }) as any;

  it('returns frozen guest contact, shipping, method and item details', async () => {
    const order = {
      id: 42,
      userId: null,
      user: null,
      customerEmail: 'guest@example.test',
      status: OrderStatus.PAID,
      shippingAddr: {
        firstName: 'Ada',
        lastName: 'Lovelace',
        line1: 'Calle Mayor 10',
        line2: '2º B',
        postalCode: '28013',
        city: 'Madrid',
        state: 'Madrid',
        country: 'ES',
        phone: '+34 600 000 000',
      },
      shippingMethodCode: 'STANDARD',
      checkoutSnapshot: {
        shippingMethodCode: 'STANDARD',
        shippingMethodLabel: 'Envío estándar 24/72h',
      },
      trackingNumber: null,
      trackingUrl: null,
      shippingCarrier: null,
      shippedAt: null,
      deliveredAt: null,
      internalNote: null,
      subtotal: decimal('20.00'),
      taxRate: decimal('0.2100'),
      taxAmount: decimal('4.20'),
      shippingCost: 495,
      discountCents: 0,
      disputeLostCents: 0,
      total: decimal('24.95'),
      currency: 'EUR',
      provider: 'stripe',
      providerRef: 'pi_guest',
      createdAt: new Date('2026-09-20T10:00:00.000Z'),
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
      items: [
        {
          id: 5,
          orderId: 42,
          productId: 7,
          title: 'Camiseta CRONOX (M)',
          unitPrice: decimal('20.00'),
          quantity: 1,
          lineTotal: decimal('20.00'),
          product: { id: 7, name: 'Nombre actual no usado para el snapshot' },
        },
      ],
    };
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
    };
    const service = new AdminOrdersService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const detail = await service.getOrderById(42);

    expect(detail).toEqual(
      expect.objectContaining({
        userEmail: 'guest@example.test',
        customer: {
          name: 'Ada Lovelace',
          email: 'guest@example.test',
          phone: '+34 600 000 000',
        },
        shippingAddress: {
          recipient: 'Ada Lovelace',
          line1: 'Calle Mayor 10',
          line2: '2º B',
          postalCode: '28013',
          city: 'Madrid',
          province: 'Madrid',
          country: 'España',
          phone: '+34 600 000 000',
        },
        shippingMethod: {
          code: 'STANDARD',
          label: 'Envío estándar 24/72h',
        },
        shippingCost: '4.95',
        paymentStatus: 'PAID',
        fulfillmentStatus: 'NOT_SHIPPED',
      }),
    );
    expect(detail.items[0]).toEqual(
      expect.objectContaining({
        title: 'Camiseta CRONOX (M)',
        variant: 'M',
        quantity: 1,
        lineTotal: '20.00',
      }),
    );
    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 42 },
        include: expect.objectContaining({
          checkoutSnapshot: expect.any(Object),
          items: expect.any(Object),
        }),
      }),
    );
  });
});

describe('AdminOrdersService Stripe safety', () => {
  const decimal = { toFixed: () => '10.00' } as any;
  const makeOrder = (overrides: Record<string, unknown> = {}) => ({
    id: 9,
    userId: 2,
    status: OrderStatus.PAID,
    provider: 'stripe',
    providerRef: 'pi_admin',
    user: { email: 'customer@example.test' },
    items: [],
    trackingNumber: null,
    trackingUrl: null,
    shippingCarrier: null,
    shippedAt: null,
    deliveredAt: null,
    internalNote: null,
    subtotal: decimal,
    taxRate: decimal,
    taxAmount: decimal,
    shippingCost: 0,
    total: decimal,
    currency: 'EUR',
    createdAt: new Date('2026-08-08T10:00:00.000Z'),
    updatedAt: new Date('2026-08-08T10:00:00.000Z'),
    ...overrides,
  });

  it('routes an admin refund through Stripe and the central lifecycle reconciler', async () => {
    const order = makeOrder();
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
    };
    const stripeService = {
      refundPaymentIntent: jest.fn().mockResolvedValue({}),
    };
    const checkoutOrdersService = {
      applyStripePaymentLifecycle: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AdminOrdersService(
      prisma as any,
      {} as any,
      {} as any,
      stripeService as any,
      checkoutOrdersService as any,
    );

    await service.refundOrder(9);

    expect(stripeService.refundPaymentIntent).toHaveBeenCalledWith(
      'pi_admin',
      'admin-refund:9:pi_admin',
    );
    expect(
      checkoutOrdersService.applyStripePaymentLifecycle,
    ).toHaveBeenCalledWith('pi_admin', OrderStatus.REFUNDED);
  });

  it('does not allow an admin to cancel a captured Stripe order without a refund', async () => {
    const order = makeOrder();
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
    };
    const service = new AdminOrdersService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.updateOrderFulfillment(9, {
        status: OrderStatus.CANCELLED,
      } as any),
    ).rejects.toThrow('debe reembolsarse');
  });
});
