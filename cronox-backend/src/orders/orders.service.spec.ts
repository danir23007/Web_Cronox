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
import { GuestOrderAccountService } from './guest-order-account.service';

describe('OrdersService checkout reservations', () => {
  let service: OrdersService;
  let prisma: any;
  let cartService: any;
  let shippingMethods: any;
  let historialService: any;
  let guestOrderAccountService: any;

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
    stripeAccountId: null,
    paymentRecoveryToken: null,
    paymentRecoveryClaimedAt: null,
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
        findFirst: jest.fn(),
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
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) =>
        callback(prisma),
      ),
    };
    prisma.user.findUnique.mockResolvedValue({ email: 'member@cronox.test' });
    cartService = { getOrCreateCart: jest.fn() };
    shippingMethods = { getMethod: jest.fn(), listAvailableMethods: jest.fn() };
    historialService = {
      incrementOrderProgress: jest.fn(),
      registerReturn: jest.fn(),
    };
    guestOrderAccountService = {
      resolveUserForCompletedOrder: jest.fn(
        async (_tx: unknown, snapshot: { userId: number | null }) => ({
          userId: snapshot.userId,
          accountCreated: false,
        }),
      ),
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
      guestOrderAccountService as GuestOrderAccountService,
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

  const recoveryInput = {
    checkoutSnapshotId: 'snap_recovery',
    paymentIntentId: 'pi_missing_live',
    stripeAccountId: 'acct_live',
    allowStripeAccountBackfill: false,
    userId: 1,
    cartId: 10,
    cartUpdatedAt: updatedAt,
    amountCents: 10495,
    currency: 'EUR',
  };

  const prepareSafeRecoveryState = () => {
    prisma.checkoutSnapshot.updateMany.mockResolvedValue({ count: 1 });
    prisma.checkoutSnapshot.findFirst.mockResolvedValue(null);
    prisma.checkoutSnapshot.findUnique.mockImplementation((args: any) => {
      const recoveryToken =
        [...prisma.checkoutSnapshot.updateMany.mock.calls]
          .reverse()
          .find((call) => call[0]?.data?.paymentRecoveryToken)?.[0]?.data
          ?.paymentRecoveryToken ?? 'recovery_token';
      const snapshot = makeSnapshot({
        id: recoveryInput.checkoutSnapshotId,
        status: 'MISSING_RECOVERY_PENDING',
        stripePaymentIntentId: recoveryInput.paymentIntentId,
        stripeAccountId: recoveryInput.stripeAccountId,
        paymentRecoveryToken: recoveryToken,
      });
      return Promise.resolve(args?.include ? snapshot : snapshot);
    });
    prisma.cart.findUnique.mockResolvedValue({ userId: 1, updatedAt });
    prisma.order.findFirst.mockResolvedValue(null);
    prisma.stripeWebhookEvent.findFirst.mockResolvedValue(null);
    prisma.checkoutStockReservation.findMany.mockResolvedValue([
      {
        id: 'reservation_recovery',
        variantId: 8,
        quantity: 2,
        status: 'RESERVED',
      },
    ]);
    prisma.checkoutStockReservation.updateMany.mockResolvedValue({ count: 1 });
    prisma.productVariant.update.mockResolvedValue({});
    prisma.stockMovement.create.mockResolvedValue({});
    prisma.checkoutSnapshot.update.mockResolvedValue({});
  };

  it('claims and finalizes live missing-intent recovery only after all safety checks', async () => {
    prepareSafeRecoveryState();

    const claim =
      await service.claimUnavailableCheckoutPaymentRecovery(recoveryInput);
    expect(claim).toMatchObject({ claimed: true });
    if (!claim.claimed) throw new Error('Expected recovery claim');

    await expect(
      service.finalizeUnavailableCheckoutPaymentRecovery(
        recoveryInput,
        claim.token,
      ),
    ).resolves.toEqual({ released: true });
    expect(prisma.checkoutSnapshot.update).toHaveBeenCalledWith({
      where: { id: recoveryInput.checkoutSnapshotId },
      data: {
        status: 'REPLACED',
        paymentRecoveryToken: null,
        paymentRecoveryClaimedAt: null,
      },
    });
  });

  it('does not recover a missing live intent when a paid order already exists', async () => {
    prepareSafeRecoveryState();
    prisma.order.findFirst.mockResolvedValue({ id: 99 });

    await expect(
      service.claimUnavailableCheckoutPaymentRecovery(recoveryInput),
    ).resolves.toEqual({ claimed: false, reason: 'ORDER_ALREADY_EXISTS' });
  });

  it('does not recover when signed success evidence makes payment state ambiguous', async () => {
    prepareSafeRecoveryState();
    prisma.stripeWebhookEvent.findFirst.mockResolvedValue({
      id: 'evt_success',
    });

    await expect(
      service.claimUnavailableCheckoutPaymentRecovery(recoveryInput),
    ).resolves.toEqual({
      claimed: false,
      reason: 'SUCCESSFUL_WEBHOOK_EXISTS',
    });
  });

  it('does not recover when another active payment snapshot exists', async () => {
    prepareSafeRecoveryState();
    prisma.checkoutSnapshot.findFirst.mockResolvedValue({ id: 'snap_other' });

    await expect(
      service.claimUnavailableCheckoutPaymentRecovery(recoveryInput),
    ).resolves.toEqual({
      claimed: false,
      reason: 'COMPETING_PAYMENT_EXISTS',
    });
  });

  it('does not finalize replacement when a success webhook wins the race', async () => {
    prepareSafeRecoveryState();
    const claim =
      await service.claimUnavailableCheckoutPaymentRecovery(recoveryInput);
    if (!claim.claimed) throw new Error('Expected recovery claim');
    prisma.stripeWebhookEvent.findFirst.mockResolvedValue({
      id: 'evt_success_race',
    });

    await expect(
      service.finalizeUnavailableCheckoutPaymentRecovery(
        recoveryInput,
        claim.token,
      ),
    ).resolves.toEqual({
      released: false,
      reason: 'SUCCESSFUL_WEBHOOK_EXISTS',
    });
    expect(prisma.checkoutSnapshot.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'REPLACED' }),
      }),
    );
  });

  it('reports a delayed current checkout payment without exposing its Stripe ID', async () => {
    prisma.checkoutSnapshot.findFirst.mockResolvedValue({
      status: 'REPLACEMENT_PENDING',
      order: null,
    });

    await expect(
      service.getCurrentCheckoutPaymentProcessingStatus(1),
    ).resolves.toEqual({
      found: false,
      isProcessed: false,
      paymentPending: true,
    });
  });

  it('reports eventual current-checkout order confirmation by safe order ID', async () => {
    const updatedAt = new Date('2026-08-10T00:08:32.000Z');
    prisma.checkoutSnapshot.findFirst.mockResolvedValue({
      status: 'ORDER_CREATED',
      order: { id: 16, status: 'PAID', updatedAt },
    });

    await expect(
      service.getCurrentCheckoutPaymentProcessingStatus(1),
    ).resolves.toEqual({
      found: true,
      orderId: 16,
      orderStatus: 'PAID',
      isProcessed: true,
      paymentPending: false,
      updatedAt,
    });
  });

  it('resolves checkout-success by an owned order ID without returning a Stripe ID', async () => {
    const updatedAt = new Date('2026-08-10T00:08:32.000Z');
    prisma.order.findFirst.mockResolvedValue({
      id: 16,
      status: 'PAID',
      providerRef: 'pi_private',
      updatedAt,
    });

    await expect(service.getPaymentProcessingStatus(1, '16')).resolves.toEqual({
      found: true,
      orderId: 16,
      orderStatus: 'PAID',
      isProcessed: true,
      updatedAt,
    });
    expect(prisma.order.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 1,
          OR: [{ providerRef: '16' }, { id: 16 }],
        }),
      }),
    );
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

  it('classifies a missing or stale checkout cart as EMPTY_CART', async () => {
    await expect(
      service.getCheckoutSummary(null, { userId: 1 }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'EMPTY_CART' }),
      status: 400,
    });
  });

  it('classifies a cart item with a missing variant as invalid cart data', () => {
    expect(() =>
      (service as any).assertCartEligibleForCheckout({
        items: [{ qty: 1, variant: null }],
      }),
    ).toThrow('INVALID_CART_ITEM_VARIANT');
  });

  it('classifies an inactive product or variant explicitly', () => {
    expect(() =>
      (service as any).assertCartEligibleForCheckout({
        items: [
          {
            qty: 1,
            variant: {
              isActive: true,
              stockQty: 1,
              product: { isActive: false },
            },
          },
        ],
      }),
    ).toThrow('INACTIVE_PRODUCT_OR_VARIANT');
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
          OR: [
            { status: 'RESERVED' },
            {
              status: 'PAYMENT_INTENT_CREATING',
              updatedAt: { lt: expect.any(Date) },
            },
          ],
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

  it('assigns a successfully paid guest order to the email-resolved User and preserves its snapshot', async () => {
    const snapshot = makeSnapshot({
      id: 'snap_guest',
      userId: null,
      anonymousId: 'opaque-guest-owner-123456',
      customerEmail: 'guest@example.test',
      stripePaymentIntentId: 'pi_guest',
      promoCodeId: null,
      promoCodeCode: null,
      shippingAddr: {
        name: 'Guest Customer',
        line1: 'Calle Uno 1',
        zip: '28001',
        city: 'Madrid',
        country: 'ES',
      },
      billingAddr: null,
    });
    const createdOrder = {
      id: 103,
      userId: 73,
      customerEmail: 'guest@example.test',
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
    prisma.order.create.mockResolvedValue({ id: 103 });
    prisma.orderItem.createMany.mockResolvedValue({ count: 1 });
    prisma.checkoutSnapshot.update.mockResolvedValue({});
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([]);
    guestOrderAccountService.resolveUserForCompletedOrder.mockResolvedValue({
      userId: 73,
      accountCreated: true,
    });
    jest
      .spyOn(service as any, 'consumeStockReservationsForCheckoutSnapshot')
      .mockResolvedValue(false);
    jest
      .spyOn(service as any, 'clearCartIfSnapshotStillCurrent')
      .mockResolvedValue(undefined);
    const fillNames = jest
      .spyOn(service as any, 'fillMissingUserNames')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'handlePromoUsageOnPaid')
      .mockResolvedValue(undefined);

    await expect(
      service.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId: 'snap_guest',
        paymentIntentId: 'pi_guest',
        amountCents: 10495,
        currency: 'EUR',
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      orderId: 103,
      userId: 73,
      status: 'PAID',
      accountCreated: true,
    });

    expect(prisma.order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 73,
        customerEmail: 'guest@example.test',
        shippingAddr: expect.objectContaining({
          line1: 'Calle Uno 1',
          country: 'España',
        }),
        providerRef: 'pi_guest',
      }),
    });
    expect(fillNames).not.toHaveBeenCalled();
    expect(historialService.incrementOrderProgress).toHaveBeenCalledWith(
      73,
      0,
      prisma,
    );
  });

  it('scopes guest payment-status lookup to both opaque owner and PaymentIntent ref', async () => {
    prisma.checkoutSnapshot.findFirst.mockResolvedValue(null);

    await expect(
      service.getPaymentProcessingStatusForOwner(
        {
          anonymousId: 'opaque-guest-owner-123456',
          customerEmail: 'guest@example.test',
        },
        'pi_guest_secure',
      ),
    ).resolves.toMatchObject({ found: false, isProcessed: false });

    expect(prisma.checkoutSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: null,
          anonymousId: 'opaque-guest-owner-123456',
          stripePaymentIntentId: 'pi_guest_secure',
        }),
      }),
    );
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
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
    expect(
      guestOrderAccountService.resolveUserForCompletedOrder,
    ).not.toHaveBeenCalled();
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

  it('retries the paid-order transaction when a concurrent checkout wins the unique email create', async () => {
    const duplicateEmail = new (Prisma as any).PrismaClientKnownRequestError(
      'duplicate email',
      'P2002',
    );
    const snapshot = makeSnapshot({
      id: 'snap_email_race',
      userId: null,
      anonymousId: 'opaque-email-race-owner-123456',
      customerEmail: 'same@example.test',
      stripePaymentIntentId: 'pi_email_race',
      promoCodeId: null,
      shippingAddr: null,
      billingAddr: null,
    });
    const createdOrder = {
      id: 104,
      userId: 88,
      status: 'PAID',
      preDisputeStatus: null,
      items: [],
    };

    prisma.$transaction
      .mockRejectedValueOnce(duplicateEmail)
      .mockImplementation(async (callback: (tx: any) => unknown) =>
        callback(prisma),
      );
    prisma.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdOrder)
      .mockResolvedValueOnce({ status: 'PAID' });
    prisma.checkoutSnapshot.findUnique
      .mockResolvedValueOnce(snapshot)
      .mockResolvedValueOnce(snapshot);
    prisma.order.create.mockResolvedValue({ id: 104 });
    prisma.orderItem.createMany.mockResolvedValue({ count: 0 });
    prisma.checkoutSnapshot.update.mockResolvedValue({});
    prisma.stripeWebhookEvent.findMany.mockResolvedValue([]);
    guestOrderAccountService.resolveUserForCompletedOrder.mockResolvedValue({
      userId: 88,
      accountCreated: false,
    });
    jest
      .spyOn(service as any, 'consumeStockReservationsForCheckoutSnapshot')
      .mockResolvedValue(false);
    jest
      .spyOn(service as any, 'clearCartIfSnapshotStillCurrent')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'handlePromoUsageOnPaid')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'recordCompletedCheckoutAnalytics')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service, 'reconcileStripePaymentLifecycle')
      .mockResolvedValue(undefined);

    await expect(
      service.createOrderFromVerifiedStripePayment({
        checkoutSnapshotId: 'snap_email_race',
        paymentIntentId: 'pi_email_race',
        amountCents: 10495,
        currency: 'EUR',
        occurredAt: new Date('2026-08-08T10:00:00.000Z'),
      }),
    ).resolves.toMatchObject({
      orderId: 104,
      userId: 88,
      created: true,
      status: 'PAID',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(guestOrderAccountService.resolveUserForCompletedOrder).toHaveBeenCalledTimes(1);
  });
});
