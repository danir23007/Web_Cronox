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
    const prisma = { order: { findUnique: jest.fn().mockResolvedValue(order) } };
    const stripeService = { refundPaymentIntent: jest.fn().mockResolvedValue({}) };
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
    expect(checkoutOrdersService.applyStripePaymentLifecycle).toHaveBeenCalledWith(
      'pi_admin',
      OrderStatus.REFUNDED,
    );
  });

  it('does not allow an admin to cancel a captured Stripe order without a refund', async () => {
    const order = makeOrder();
    const prisma = {
      order: { findUnique: jest.fn().mockResolvedValue(order) },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(prisma)),
    };
    const service = new AdminOrdersService(
      prisma as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.updateOrderFulfillment(9, { status: OrderStatus.CANCELLED } as any),
    ).rejects.toThrow('debe reembolsarse');
  });
});
