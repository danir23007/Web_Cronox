// Focused checkout safety tests.
jest.mock('@prisma/client', () => ({
  PrismaClient: class PrismaClient {},
  Prisma: {
    PrismaClientKnownRequestError: class PrismaClientKnownRequestError extends Error {
      code: string;
      constructor(message = 'PRISMA', code = 'P0000') {
        super(message);
        this.code = code;
      }
    },
    JsonNull: Symbol('JsonNull'),
  },
  OrderStatus: {
    PENDING: 'PENDING',
    PAID: 'PAID',
    DISPUTED: 'DISPUTED',
    PROCESSING: 'PROCESSING',
    DELIVERED: 'DELIVERED',
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
    SHIPPED: 'SHIPPED',
  },
  PromoCodeType: { PERCENT: 'PERCENT', FIXED: 'FIXED' },
  Role: { ADMIN: 'ADMIN', USER: 'USER' },
}));

import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CartService } from '../cart/cart.service';
import { TaxConfigService } from '../common/tax/tax-config.service';
import { HistorialService } from '../historial/historial.service';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from './orders.service';

describe('OrdersService checkout reservations', () => {
  let service: OrdersService;
  let prisma: any;
  let cartService: any;
  let shippingMethods: any;
  let historialService: any;

  const updatedAt = new Date('2026-08-08T10:00:00.000Z');
  const preview = {
    cart: {
      id: 10,
      userId: 1,
      updatedAt,
      items: [],
    },
    computation: {
      currency: 'EUR',
      taxRate: new Decimal('0.2100'),
      taxAmount: new Decimal('17.36'),
      lineItems: [
        {
          productId: 7,
          variantId: 8,
          title: 'Camiseta (M)',
          quantity: 2,
          unitPrice: new Decimal('50.00'),
          lineTotal: new Decimal('100.00'),
        },
      ],
    },
    summary: {
      currency: 'EUR',
      subtotal: '100.00',
      taxRate: '0.2100',
      taxAmount: '17.36',
      shippingCost: '4.95',
      discount: '0.00',
      total: '104.95',
    },
    lineItems: [
      {
        productId: 7,
        title: 'Camiseta (M)',
        quantity: 2,
        unitPrice: '50.00',
        lineTotal: '100.00',
      },
    ],
    shippingMethod: {
      id: 2,
      code: 'EXPRESS',
      label: 'Express',
      priceCents: 495,
      amountCents: 495,
      description: null,
      amount: '4.95',
    },
    totals: {
      subtotalCents: 10000,
      shippingCents: 495,
      discountCents: 0,
      totalCents: 10495,
    },
    appliedPromo: null,
  };

  const makeSnapshot = (overrides: Record<string, unknown> = {}) => ({
    id: 'snap_new',
    userId: 1,
    cartId: 10,
    orderId: null,
    requestFingerprint: 'fingerprint_1',
    stripePaymentIntentId: null,
    status: 'RESERVED',
    expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    currency: 'EUR',
    subtotalCents: 10000,
    taxRate: new Decimal('0.2100'),
    taxAmountCents: 1736,
    shippingCostCents: 495,
    shippingMethodId: 2,
    shippingMethodCode: 'EXPRESS',
    shippingMethodLabel: 'Express',
    shippingMethodDescription: null,
    shippingMethodPriceCents: 495,
    discountCents: 0,
    totalCents: 10495,
    items: [
      {
        productId: 7,
        variantId: 8,
        title: 'Camiseta (M)',
        quantity: 2,
        unitPriceCents: 5000,
        lineTotalCents: 10000,
      },
    ],
    ...overrides,
  });

  beforeEach(() => {
    prisma = {
      checkoutSnapshot: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      checkoutStockReservation: {
        create: jest.fn(),
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      productVariant: { updateMany: jest.fn(), update: jest.fn() },
      stockMovement: { create: jest.fn(), updateMany: jest.fn() },
      cart: {
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      cartItem: {
        delete: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
      },
      order: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      orderItem: { createMany: jest.fn() },
      promoCode: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      promoCodeRedemption: { create: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      stripeWebhookEvent: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
    };
    cartService = { getOrCreateCart: jest.fn() };
    shippingMethods = { getMethod: jest.fn(), listAvailableMethods: jest.fn() };
    historialService = {
      incrementOrderProgress: jest.fn(),
      registerReturn: jest.fn(),
    };
    service = new OrdersService(
      prisma as PrismaService,
      cartService as CartService,
      {
        getDefaultVat: jest.fn().mockReturnValue(0.21),
        getPaymentProvider: jest.fn(),
      } as unknown as TaxConfigService,
      shippingMethods,
      historialService as HistorialService,
    );
    jest.spyOn(service as any, 'getCheckoutPreview').mockResolvedValue(preview);
    jest
      .spyOn(service as any, 'buildCheckoutRequestFingerprint')
      .mockReturnValue('fingerprint_1');
  });

  it('reuses an active snapshot for an identical checkout request', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    prisma.checkoutSnapshot.findFirst.mockResolvedValue(
      makeSnapshot({
        id: 'snap_existing',
        stripePaymentIntentId: 'pi_existing',
        status: 'PAYMENT_BOUND',
        expiresAt,
      }),
    );

    const result = await service.createCheckoutSnapshot(
      1,
      { shippingMethod: 'EXPRESS' as any },
      { cart: preview.cart as any },
    );

    expect(result).toMatchObject({
      checkoutSnapshotId: 'snap_existing',
      paymentIntentId: 'pi_existing',
      amountCents: 10495,
      lineItems: [expect.objectContaining({ title: 'Camiseta (M)' })],
      reused: true,
      expired: false,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('atomically reserves each active variant before returning a new snapshot', async () => {
    prisma.checkoutSnapshot.findFirst.mockResolvedValue(null);
    prisma.cart.findUnique.mockResolvedValue({ userId: 1, updatedAt });
    prisma.checkoutSnapshot.create.mockResolvedValue(makeSnapshot());
    prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutStockReservation.create.mockResolvedValue({});
    prisma.stockMovement.create.mockResolvedValue({});

    await service.createCheckoutSnapshot(
      1,
      { shippingMethod: 'EXPRESS' as any },
      { cart: preview.cart as any },
    );

    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 8,
        isActive: true,
        stockQty: { gte: 2 },
      }),
      data: { stockQty: { decrement: 2 } },
    });
    expect(prisma.checkoutStockReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        checkoutSnapshotId: 'snap_new',
        variantId: 8,
        quantity: 2,
        status: 'RESERVED',
      }),
    });
  });

  it('releases a cancelled checkout reservation exactly once', async () => {
    prisma.checkoutSnapshot.findUnique.mockResolvedValue({
      id: 'snap_cancelled',
      orderId: null,
      status: 'PAYMENT_BOUND',
      items: [],
    });
    prisma.checkoutStockReservation.findMany.mockResolvedValue([
      { id: 'reservation_1', variantId: 8, quantity: 2 },
    ]);
    prisma.checkoutStockReservation.updateMany.mockResolvedValue({ count: 1 });
    prisma.productVariant.update.mockResolvedValue({});
    prisma.stockMovement.create.mockResolvedValue({});
    prisma.checkoutSnapshot.update.mockResolvedValue({});

    await service.releaseCheckoutSnapshot(
      'snap_cancelled',
      'PAYMENT_CANCELLED',
    );

    expect(prisma.productVariant.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { stockQty: { increment: 2 } },
    });
    expect(prisma.checkoutStockReservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'reservation_1', status: 'RESERVED' },
      data: expect.objectContaining({ status: 'RELEASED' }),
    });
    expect(prisma.checkoutSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'snap_cancelled' },
      data: { status: 'PAYMENT_CANCELLED' },
    });
  });

  it('returns the server-owned active snapshot for secure replacement when checkout fields change', async () => {
    jest
      .spyOn(service as any, 'buildCheckoutRequestFingerprint')
      .mockReturnValue('different_address_fingerprint');
    prisma.checkoutSnapshot.findFirst.mockResolvedValue(makeSnapshot());

    await expect(
      service.createCheckoutSnapshot(
        1,
        {
          shippingMethod: 'EXPRESS' as any,
          shippingAddress: { line1: 'Different address' },
        },
        { cart: preview.cart as any },
      ),
    ).resolves.toMatchObject({
      checkoutSnapshotId: 'snap_new',
      replacementRequired: true,
      reused: true,
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('fingerprints shipping, valid promotion and normalized address changes', () => {
    (service as any).buildCheckoutRequestFingerprint.mockRestore();
    const standardPreview = {
      ...preview,
      shippingMethod: { ...preview.shippingMethod, code: 'STANDARD' },
    };
    const baseParams = {
      shippingMethod: 'STANDARD',
      shippingAddress: { city: 'Madrid', line1: 'Calle 1' },
    };
    const fingerprint = (checkoutPreview: unknown, params: unknown) =>
      (service as any).buildCheckoutRequestFingerprint(
        1,
        checkoutPreview,
        params,
      );
    const standard = fingerprint(standardPreview, baseParams);

    expect(
      fingerprint(standardPreview, {
        ...baseParams,
        shippingAddress: { line1: 'Calle 1', city: 'Madrid' },
      }),
    ).toBe(standard);
    expect(
      fingerprint(preview, { ...baseParams, shippingMethod: 'EXPRESS' }),
    ).not.toBe(standard);
    expect(
      fingerprint(
        { ...standardPreview, appliedPromo: { valid: true, code: 'SAVE10' } },
        { ...baseParams, promoCode: 'SAVE10' },
      ),
    ).not.toBe(standard);
    expect(
      fingerprint(standardPreview, {
        ...baseParams,
        shippingAddress: { city: 'Barcelona', line1: 'Calle 1' },
      }),
    ).not.toBe(standard);
  });

  it('returns an expired active snapshot even when the request changed so it can be safely released', async () => {
    jest
      .spyOn(service as any, 'buildCheckoutRequestFingerprint')
      .mockReturnValue('different_address_fingerprint');
    prisma.checkoutSnapshot.findFirst.mockResolvedValue(
      makeSnapshot({ expiresAt: new Date(Date.now() - 1) }),
    );

    const result = await service.createCheckoutSnapshot(
      1,
      { shippingMethod: 'EXPRESS' as any },
      { cart: preview.cart as any },
    );

    expect(result).toMatchObject({
      reused: true,
      expired: true,
      replacementRequired: true,
    });
  });

  it('claims replacement only for the authenticated user, cart and server snapshot', async () => {
    prisma.checkoutSnapshot.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.claimCheckoutSnapshotReplacement(1, 10, 'snap_bound'),
    ).resolves.toBe(true);

    expect(prisma.checkoutSnapshot.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'snap_bound',
        userId: 1,
        cartId: 10,
        orderId: null,
        status: { in: ['RESERVED', 'PAYMENT_BOUND'] },
      },
      data: { status: 'REPLACEMENT_PENDING' },
    });
  });

  it('subtracts only purchased quantities and preserves later cart additions', async () => {
    const snapshot = makeSnapshot({
      items: [
        { variantId: 8, quantity: 1 },
        { variantId: 8, quantity: 1 },
      ],
    });
    prisma.cart.updateMany.mockResolvedValue({ count: 1 });
    prisma.cartItem.findMany
      .mockResolvedValueOnce([
        { id: 11, variantId: 8, qty: 3, priceAtAdd: 3495 },
        { id: 12, variantId: 9, qty: 1, priceAtAdd: 2995 },
      ])
      .mockResolvedValueOnce([
        { qty: 1, priceAtAdd: 3495 },
        { qty: 1, priceAtAdd: 2995 },
      ]);

    await (service as any).clearCartIfSnapshotStillCurrent(prisma, snapshot);

    expect(prisma.cartItem.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: { qty: 1 },
    });
    expect(prisma.cartItem.delete).not.toHaveBeenCalledWith({
      where: { id: 12 },
    });
    expect(prisma.cart.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { itemsCount: 2, subtotal: 6490 },
    });
  });

  it('removes all purchased items and zeros totals when the cart is unchanged', async () => {
    const snapshot = makeSnapshot({ items: [{ variantId: 8, quantity: 2 }] });
    prisma.cart.updateMany.mockResolvedValue({ count: 1 });
    prisma.cartItem.findMany
      .mockResolvedValueOnce([
        { id: 11, variantId: 8, qty: 2, priceAtAdd: 5000 },
      ])
      .mockResolvedValueOnce([]);

    await (service as any).clearCartIfSnapshotStillCurrent(prisma, snapshot);

    expect(prisma.cartItem.delete).toHaveBeenCalledWith({ where: { id: 11 } });
    expect(prisma.cart.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { itemsCount: 0, subtotal: 0 },
    });
  });

  it('rejects a zero-total checkout before reserving inventory or calling Stripe', async () => {
    jest.spyOn(service as any, 'getCheckoutPreview').mockResolvedValue({
      ...preview,
      totals: { ...preview.totals, totalCents: 0 },
    });

    await expect(
      service.createCheckoutSnapshot(
        1,
        { shippingMethod: 'EXPRESS' as any },
        { cart: preview.cart as any },
      ),
    ).rejects.toThrow('ZERO_TOTAL_CHECKOUT_NOT_SUPPORTED');

    expect(prisma.checkoutSnapshot.create).not.toHaveBeenCalled();
    expect(prisma.productVariant.updateMany).not.toHaveBeenCalled();
  });

  it('recovers a stale PaymentIntent creation claim with the deterministic snapshot key', async () => {
    prisma.checkoutSnapshot.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.claimCheckoutPaymentIntentCreation('snap_creating'),
    ).resolves.toBe(true);

    expect(prisma.checkoutSnapshot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'snap_creating',
          status: { in: ['RESERVED', 'PAYMENT_INTENT_CREATING'] },
        }),
      }),
    );
  });

  it('returns consumed stock and records purchase history only once across refund retries', async () => {
    const snapshot = makeSnapshot({ id: 'snap_refund' });
    const refundedOrder = {
      id: 55,
      userId: 1,
      status: 'REFUNDED',
      preDisputeStatus: null,
      items: [{ quantity: 2 }],
    };
    prisma.order.findUnique.mockResolvedValue(refundedOrder);
    prisma.checkoutSnapshot.findUnique.mockResolvedValue(snapshot);
    prisma.checkoutSnapshot.updateMany
      .mockResolvedValueOnce({ count: 1 }) // return-stock claim
      .mockResolvedValueOnce({ count: 1 }) // snapshot REFUNDED state
      .mockResolvedValueOnce({ count: 0 }) // duplicate return-stock claim
      .mockResolvedValueOnce({ count: 1 }); // duplicate snapshot state
    prisma.checkoutStockReservation.findMany
      .mockResolvedValueOnce([
        { id: 'reservation_consumed', variantId: 8, quantity: 2 },
      ])
      .mockResolvedValue([]);
    prisma.checkoutStockReservation.updateMany.mockResolvedValue({ count: 1 });
    prisma.productVariant.update.mockResolvedValue({});
    prisma.stockMovement.create.mockResolvedValue({});

    await service.applyStripePaymentLifecycle('pi_refund', 'REFUNDED' as any);
    await service.applyStripePaymentLifecycle('pi_refund', 'REFUNDED' as any);

    expect(prisma.productVariant.update).toHaveBeenCalledTimes(1);
    expect(historialService.registerReturn).toHaveBeenCalledTimes(1);
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reason: 'refund',
        orderId: 55,
        checkoutSnapshotId: 'snap_refund',
      }),
    });
  });

  it('uses Stripe occurrence order so an old dispute cannot overwrite a later reinstatement', async () => {
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      {
        lifecycleStatus: 'PAID',
        occurredAt: new Date('2026-08-08T10:01:00.000Z'),
        type: 'charge.dispute.closed',
      },
      {
        lifecycleStatus: 'DISPUTED',
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
        type: 'charge.dispute.created',
      },
    ]);
    prisma.order.findUnique.mockResolvedValue({
      id: 88,
      userId: 1,
      status: 'SHIPPED',
      preDisputeStatus: null,
      items: [],
    });

    await service.reconcileStripePaymentLifecycle('pi_chronology');

    expect(prisma.stripeWebhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      }),
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('uses a paid dispute resolution as the deterministic tie-break within Stripe Event.created precision', async () => {
    const occurredAt = new Date('2026-08-08T10:00:00.000Z');
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      {
        lifecycleStatus: 'DISPUTED',
        occurredAt,
        type: 'charge.dispute.created',
      },
      {
        lifecycleStatus: 'PAID',
        occurredAt,
        type: 'charge.dispute.closed',
      },
    ]);

    await expect(
      (service as any).resolvePersistedPaymentLifecycle(
        prisma,
        'pi_same_second',
      ),
    ).resolves.toBe('PAID');
  });

  it('keeps a signature-verified failed full-refund event authoritative for reconciliation', async () => {
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      {
        lifecycleStatus: 'REFUNDED',
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
        type: 'charge.refunded',
        status: 'FAILED',
      },
    ]);

    await expect(
      (service as any).resolvePersistedPaymentLifecycle(
        prisma,
        'pi_failed_refund',
      ),
    ).resolves.toBe('REFUNDED');
    expect(prisma.stripeWebhookEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          paymentIntentId: 'pi_failed_refund',
          lifecycleStatus: { not: null },
        },
      }),
    );
  });

  it('records a closed partial loss before payment success as a non-additive PAID lifecycle without restocking', async () => {
    prisma.checkoutSnapshot.findUnique.mockResolvedValue({
      id: 'snap_partial_loss',
      orderId: null,
      status: 'DISPUTED',
      totalCents: 10495,
    });
    prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      { amountCents: 2500 },
    ]);
    prisma.checkoutSnapshot.update.mockResolvedValue({});

    await expect(
      service.recordStripeClosedLostDispute({
        eventId: 'evt_partial_loss',
        paymentIntentId: 'pi_partial_loss',
        amountCents: 2500,
      }),
    ).resolves.toBe('PARTIAL');

    expect(prisma.stripeWebhookEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'evt_partial_loss', paymentIntentId: 'pi_partial_loss' },
      data: { amountCents: 2500 },
    });
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt_partial_loss' },
      data: { lifecycleStatus: 'PAID' },
    });
    expect(prisma.checkoutSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'snap_partial_loss' },
      data: { disputeLostCents: 2500 },
    });
    expect(prisma.productVariant.update).not.toHaveBeenCalled();

    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      {
        lifecycleStatus: 'PAID',
        occurredAt: new Date('2026-08-09T10:00:00.000Z'),
        type: 'charge.dispute.closed',
      },
    ]);
    await expect(
      (service as any).resolvePersistedPaymentLifecycle(
        prisma,
        'pi_partial_loss',
      ),
    ).resolves.toBe('PAID');
  });

  it('maps a closed loss equal to the frozen total into the full refund lifecycle', async () => {
    prisma.checkoutSnapshot.findUnique.mockResolvedValue({
      id: 'snap_full_loss',
      orderId: 55,
      status: 'DISPUTED',
      totalCents: 10495,
    });
    prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      { amountCents: 10495 },
    ]);
    prisma.checkoutSnapshot.update.mockResolvedValue({});
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.recordStripeClosedLostDispute({
        eventId: 'evt_full_loss',
        paymentIntentId: 'pi_full_loss',
        amountCents: 10495,
      }),
    ).resolves.toBe('FULL');

    expect(prisma.stripeWebhookEvent.updateMany).toHaveBeenCalledWith({
      where: { id: 'evt_full_loss', paymentIntentId: 'pi_full_loss' },
      data: { amountCents: 10495 },
    });
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt_full_loss' },
      data: { lifecycleStatus: 'REFUNDED' },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 55 },
      data: { disputeLostCents: 10495 },
    });
  });

  it('aggregates distinct closed-loss events and turns the aggregate full only at the frozen total', async () => {
    prisma.checkoutSnapshot.findUnique.mockResolvedValue({
      id: 'snap_aggregate_loss',
      orderId: 77,
      status: 'DISPUTED',
      totalCents: 1000,
      disputeLostCents: 400,
    });
    prisma.checkoutSnapshot.update.mockResolvedValue({});
    prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      { amountCents: 400 },
      { amountCents: 600 },
    ]);
    prisma.stripeWebhookEvent.update.mockResolvedValue({});
    prisma.order.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.recordStripeClosedLostDispute({
        eventId: 'evt_loss_600',
        paymentIntentId: 'pi_aggregate_loss',
        amountCents: 600,
      }),
    ).resolves.toBe('FULL');

    expect(prisma.checkoutSnapshot.update).toHaveBeenLastCalledWith({
      where: { id: 'snap_aggregate_loss' },
      data: { disputeLostCents: 1000 },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 77 },
      data: { disputeLostCents: 1000 },
    });
    expect(prisma.stripeWebhookEvent.update).toHaveBeenCalledWith({
      where: { id: 'evt_loss_600' },
      data: { lifecycleStatus: 'REFUNDED' },
    });
  });

  it('does not add a replayed closed-loss event twice', async () => {
    prisma.checkoutSnapshot.findUnique.mockResolvedValue({
      id: 'snap_replayed_loss',
      orderId: null,
      status: 'DISPUTED',
      totalCents: 1000,
      disputeLostCents: 400,
    });
    prisma.checkoutSnapshot.update.mockResolvedValue({});
    prisma.stripeWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([
      { amountCents: 400 },
    ]);
    prisma.stripeWebhookEvent.update.mockResolvedValue({});

    await expect(
      service.recordStripeClosedLostDispute({
        eventId: 'evt_loss_replayed',
        paymentIntentId: 'pi_replayed_loss',
        amountCents: 400,
      }),
    ).resolves.toBe('PARTIAL');
    await expect(
      service.recordStripeClosedLostDispute({
        eventId: 'evt_loss_replayed',
        paymentIntentId: 'pi_replayed_loss',
        amountCents: 400,
      }),
    ).resolves.toBe('PARTIAL');

    expect(prisma.checkoutSnapshot.update).toHaveBeenLastCalledWith({
      where: { id: 'snap_replayed_loss' },
      data: { disputeLostCents: 400 },
    });
  });

  it('re-reads a snapshot after locking so a delayed loss handler cannot overwrite a completed refund', async () => {
    prisma.checkoutSnapshot.findUnique
      .mockResolvedValueOnce({ id: 'snap_terminal_loss' })
      .mockResolvedValueOnce({
        id: 'snap_terminal_loss',
        orderId: 77,
        status: 'REFUNDED',
        totalCents: 1000,
      });
    prisma.checkoutSnapshot.update.mockResolvedValue({});

    await expect(
      service.recordStripeClosedLostDispute({
        eventId: 'evt_delayed_loss',
        paymentIntentId: 'pi_terminal_loss',
        amountCents: 600,
      }),
    ).resolves.toBe('IGNORED');

    expect(prisma.checkoutSnapshot.update).toHaveBeenCalledWith({
      where: { id: 'snap_terminal_loss' },
      data: { updatedAt: expect.any(Date) },
    });
    expect(prisma.checkoutSnapshot.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ disputeLostCents: 400 }),
      }),
    );
  });

  it('copies a partial loss frozen before payment success onto the eventual paid order', async () => {
    const snapshot = makeSnapshot({
      id: 'snap_before_success',
      userId: 1,
      stripePaymentIntentId: 'pi_before_success',
      disputeLostCents: 2500,
      promoCodeId: null,
      promoCodeCode: null,
      shippingAddr: null,
      billingAddr: null,
    });
    const createdOrder = {
      id: 101,
      userId: 1,
      status: 'PAID',
      preDisputeStatus: null,
      items: [],
    };
    prisma.checkoutSnapshot.findUnique
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot);
    prisma.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdOrder)
      .mockResolvedValueOnce(createdOrder)
      .mockResolvedValueOnce({ status: 'PAID' });
    prisma.order.create.mockResolvedValue({ id: 101 });
    prisma.orderItem.createMany.mockResolvedValue({ count: 1 });
    prisma.checkoutSnapshot.update.mockResolvedValue({});
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([]);
    jest
      .spyOn(service as any, 'consumeStockReservationsForCheckoutSnapshot')
      .mockResolvedValue(false);
    jest
      .spyOn(service as any, 'clearCartIfSnapshotStillCurrent')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'fillMissingUserNames')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'handlePromoUsageOnPaid')
      .mockResolvedValue(undefined);

    await expect(
      service.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId: 'snap_before_success',
        paymentIntentId: 'pi_before_success',
        amountCents: 10495,
        currency: 'EUR',
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ orderId: 101, status: 'PAID' });

    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ disputeLostCents: 2500 }),
    });
    expect(
      (service as any).clearCartIfSnapshotStillCurrent,
    ).toHaveBeenCalledTimes(1);
  });

  it('does not subtract cart quantities again for a duplicate successful webhook', async () => {
    const snapshot = makeSnapshot({
      stripePaymentIntentId: 'pi_already_fulfilled',
    });
    const existingOrder = {
      id: 102,
      userId: 1,
      status: 'PAID',
      items: [],
    };
    prisma.checkoutSnapshot.findUnique.mockResolvedValue(snapshot);
    prisma.order.findUnique
      .mockResolvedValueOnce(existingOrder)
      .mockResolvedValueOnce({ status: 'PAID' });
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([]);
    const clearCart = jest.spyOn(
      service as any,
      'clearCartIfSnapshotStillCurrent',
    );

    await expect(
      service.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId: 'snap_new',
        paymentIntentId: 'pi_already_fulfilled',
        amountCents: 10495,
        currency: 'EUR',
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({ created: false, orderId: 102 });

    expect(clearCart).not.toHaveBeenCalled();
    expect(prisma.order.create).not.toHaveBeenCalled();
  });

  it('rejects a signed payment that occurred after snapshot expiry but accepts a late delivery from before expiry', async () => {
    const expiresAt = new Date('2026-08-08T10:30:00.000Z');
    prisma.checkoutSnapshot.findUnique.mockResolvedValue(
      makeSnapshot({ stripePaymentIntentId: 'pi_expiry', expiresAt }),
    );

    await expect(
      service.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId: 'snap_new',
        paymentIntentId: 'pi_expiry',
        amountCents: 10495,
        currency: 'EUR',
        occurredAt: new Date(expiresAt.getTime() + 1),
      }),
    ).rejects.toThrow('STRIPE_PAYMENT_AFTER_CHECKOUT_EXPIRY');

    const existingOrder = {
      id: 89,
      userId: 1,
      status: 'PAID',
      preDisputeStatus: null,
      items: [],
    };
    prisma.order.findUnique.mockResolvedValue(existingOrder);
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([]);

    await expect(
      service.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId: 'snap_new',
        paymentIntentId: 'pi_expiry',
        amountCents: 10495,
        currency: 'EUR',
        occurredAt: new Date(expiresAt.getTime() - 1),
      }),
    ).resolves.toMatchObject({ orderId: 89, status: 'PAID' });
  });

  it('treats a concurrent providerRef unique conflict as duplicate fulfillment, not a refund-worthy failure', async () => {
    const duplicate = new (Prisma as any).PrismaClientKnownRequestError(
      'duplicate providerRef',
      'P2002',
    );
    const existingOrder = {
      id: 91,
      userId: 1,
      status: 'PAID',
      preDisputeStatus: null,
      items: [],
    };
    prisma.$transaction
      .mockRejectedValueOnce(duplicate)
      .mockImplementationOnce(async (callback: (tx: any) => unknown) =>
        callback(prisma),
      );
    prisma.order.findUnique.mockResolvedValue(existingOrder);
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([]);

    await expect(
      service.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId: 'snap_duplicate',
        paymentIntentId: 'pi_duplicate',
        amountCents: 10495,
        currency: 'EUR',
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      orderId: 91,
      created: false,
      status: 'PAID',
    });

    expect(prisma.order.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { providerRef: 'pi_duplicate' } }),
    );
  });
});
