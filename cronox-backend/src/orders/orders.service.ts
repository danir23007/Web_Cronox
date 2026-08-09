// [ORDERS] Lógica de negocio para checkout y pedidos
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { OrderStatus, Prisma, PromoCodeType, Role } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  CartService,
  cartInclude,
  type CartWithItems,
} from '../cart/cart.service';
import { TaxConfigService } from '../common/tax/tax-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { HistorialService } from '../historial/historial.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { PaginationDto } from './dto/pagination.dto';
import {
  FREE_SHIPPING_THRESHOLD_CENTS,
  ShippingMethodOption,
  ShippingMethodsService,
} from '../shipping-methods/shipping-methods.service';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';
import { hasAnyRole } from '../common/roles.utils';

const DEFAULT_CURRENCY = 'EUR';
const CHECKOUT_SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const WEBHOOK_EVENT_STALE_MS = 5 * 60 * 1000;
const CONFIRMATION_EMAIL_CLAIM_STALE_MS = 10 * 60 * 1000;
const ACTIVE_CHECKOUT_SNAPSHOT_STATUSES = [
  'RESERVED',
  'PAYMENT_INTENT_CREATING',
  'PAYMENT_BOUND',
  'REPLACEMENT_PENDING',
  'DISPUTED',
];
const EXPIRABLE_CHECKOUT_SNAPSHOT_STATUSES = [
  'RESERVED',
  'PAYMENT_INTENT_CREATING',
  'PAYMENT_BOUND',
  'REPLACEMENT_PENDING',
];

type CartSnapshot = CartWithItems;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

type CheckoutSnapshotWithItems = Prisma.CheckoutSnapshotGetPayload<{
  include: { items: true };
}>;

type VerifiedStripeOrderResult = {
  orderId: number;
  userId: number;
  checkoutSnapshotId: string;
  created: boolean;
  status: OrderStatus;
};

type StripeLifecycleStatus =
  | typeof OrderStatus.REFUNDED
  | typeof OrderStatus.DISPUTED
  | typeof OrderStatus.PAID;

type StripeWebhookEventInput = {
  id: string;
  type: string;
  paymentIntentId?: string;
  occurredAt: Date;
  lifecycleStatus?: OrderStatus;
  amountCents?: number;
};

type CheckoutSnapshotResponse = {
  checkoutSnapshotId: string;
  cartId: number;
  amountCents: number;
  currency: string;
  summary: CheckoutSummaryResponse;
  lineItems: CheckoutLineItemResponse[];
  shippingMethod: ShippingMethodPublic;
  totals: CheckoutTotals;
  paymentIntentId: string | null;
  status: string;
  expiresAt: Date;
  reused: boolean;
  expired: boolean;
  replacementRequired: boolean;
};

type CheckoutLineItem = {
  productId: number;
  variantId: number;
  title: string;
  quantity: number;
  unitPrice: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

type CheckoutComputation = {
  currency: string;
  taxRate: Prisma.Decimal;
  subtotal: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  shippingCost: Prisma.Decimal;
  shippingCostCents: number;
  discount: Prisma.Decimal;
  discountCents: number;
  total: Prisma.Decimal;
  lineItems: CheckoutLineItem[];
  itemsTotalCents: number;
};

type ShippingMethodPublic = ShippingMethodOption & { amount: string };

type CheckoutSummaryResponse = {
  // [STRIPE]
  currency: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  shippingCost: string;
  discount: string;
  total: string;
};

type CheckoutLineItemResponse = {
  // [STRIPE]
  productId: number;
  title: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

type CheckoutMetadata = {
  cartId: number;
  userId: number;
  shippingMethod: ShippingMethodCode;
  shippingCostCents: number;
  itemsTotalCents: number;
  promoCode?: string;
  discountCents?: number;
};

type CheckoutPreview = {
  // [STRIPE]
  cart: CartSnapshot;
  computation: CheckoutComputation;
  summary: CheckoutSummaryResponse;
  lineItems: CheckoutLineItemResponse[];
  metadata: CheckoutMetadata;
  shippingMethod: ShippingMethodPublic;
  totals: CheckoutTotals;
  appliedPromo?: PromoApplication | null;
};

type CheckoutTotals = {
  subtotalCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
};

type CheckoutShippingMethod = ShippingMethodOption & { priceCents: number };

type CheckoutSummary = {
  cart: CartSnapshot | null;
  currency: string;
  shippingMethods: CheckoutShippingMethod[];
  selectedShippingMethod: CheckoutShippingMethod | null;
  totals: CheckoutTotals;
  appliedPromo?: PromoApplication | null;
};

type PrismaClientOrTx = PrismaService | Prisma.TransactionClient;

type AuthenticatedUser = {
  id: number;
  role: Role | null;
};

type PromoApplication = {
  valid: boolean;
  code?: string;
  discountCents: number;
  totalBeforeCents: number;
  totalAfterCents: number;
  message?: string;
  discountLineLabel?: string;
  promoId?: number;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly allowNegativeStock =
    process.env.ALLOW_NEGATIVE_STOCK === 'true'; // [STOCK]

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly taxConfig: TaxConfigService,
    private readonly shippingMethods: ShippingMethodsService,
    private readonly historialService: HistorialService,
  ) {}

  async getCheckoutSummary(
    cart: CartSnapshot | null,
    params: {
      userId: number;
      shippingMethod?: ShippingMethodCode;
      promoCode?: string;
    },
  ): Promise<CheckoutSummary> {
    const hasItems = Array.isArray(cart?.items) && cart.items.length > 0;

    if (!hasItems) {
      throw new BadRequestException({
        code: 'EMPTY_CART',
        message: 'No puedes iniciar el checkout sin productos en el carrito.',
      });
    }

    this.assertCartEligibleForCheckout(cart);

    const itemsTotalCents = hasItems ? this.computeItemsTotalCents(cart) : 0;
    let methods =
      await this.shippingMethods.listAvailableMethods(itemsTotalCents);

    const shippingMethods = methods.map((method: any) => {
      const priceFromModel =
        typeof method.price === 'number' ? method.price : 0;

      const priceCents =
        (typeof method.priceCents === 'number' && method.priceCents) ??
        (typeof method.amountCents === 'number' && method.amountCents) ??
        priceFromModel;

      const amountCents =
        (typeof method.amountCents === 'number' && method.amountCents) ??
        (typeof method.priceCents === 'number' && method.priceCents) ??
        priceFromModel;

      return {
        ...method,
        priceCents,
        amountCents,
      } as CheckoutShippingMethod;
    });

    let selectedShippingMethod = hasItems
      ? this.pickShippingMethod(shippingMethods, params.shippingMethod)
      : null;
    const baseTotals = hasItems
      ? this.calculateCartTotals(cart, selectedShippingMethod)
      : { subtotalCents: 0, shippingCents: 0, discountCents: 0, totalCents: 0 };

    const currency =
      cart?.items[0]?.variant?.product?.currency ?? DEFAULT_CURRENCY;
    const normalizedPromo = this.normalizePromoCode(params.promoCode);
    let appliedPromo: PromoApplication | null = null;
    let totals = baseTotals;
    let appliedDiscountCents = 0;

    if (normalizedPromo && hasItems && selectedShippingMethod) {
      appliedPromo = await this.computePromoApplication(
        cart,
        selectedShippingMethod,
        normalizedPromo,
        baseTotals,
        { userId: params.userId },
      );
      if (appliedPromo.valid && appliedPromo.discountCents > 0) {
        appliedDiscountCents = appliedPromo.discountCents;
      }
    }

    if (hasItems) {
      methods = await this.shippingMethods.listAvailableMethods(
        itemsTotalCents,
        appliedDiscountCents,
      );

      const methodsForTotals = methods.map((method: any) => {
        const priceFromModel =
          typeof method.price === 'number' ? method.price : 0;

        const priceCents =
          (typeof method.priceCents === 'number' && method.priceCents) ??
          (typeof method.amountCents === 'number' && method.amountCents) ??
          priceFromModel;

        const amountCents =
          (typeof method.amountCents === 'number' && method.amountCents) ??
          (typeof method.priceCents === 'number' && method.priceCents) ??
          priceFromModel;

        return {
          ...method,
          priceCents,
          amountCents,
        } as CheckoutShippingMethod;
      });

      selectedShippingMethod = this.pickShippingMethod(
        methodsForTotals,
        params.shippingMethod,
      );

      totals = this.calculateCartTotals(
        cart,
        selectedShippingMethod,
        appliedDiscountCents,
      );

      if (appliedPromo?.valid) {
        appliedPromo = {
          ...appliedPromo,
          totalAfterCents: totals.totalCents,
        };
      }

      // Reemplazamos la lista de métodos por la que refleja el descuento aplicado
      shippingMethods.splice(0, shippingMethods.length, ...methodsForTotals);
    }

    return {
      cart,
      currency,
      shippingMethods,
      selectedShippingMethod,
      totals,
      appliedPromo,
    };
  }

  async getCheckoutPreview(
    userId: number,
    params: { shippingMethod: ShippingMethodCode; promoCode?: string },
    options: { cart?: CartSnapshot | null } = {},
  ): Promise<CheckoutPreview> {
    // [STRIPE]
    const cart =
      options.cart ?? (await this.cartService.getOrCreateCart({ userId }));

    if (cart.userId !== userId) {
      throw new ForbiddenException('CART_ACCESS_DENIED');
    }

    if (!cart.items.length) {
      throw new BadRequestException({
        code: 'EMPTY_CART',
        message: 'No puedes iniciar el checkout sin productos en el carrito.',
      });
    }

    this.assertCartEligibleForCheckout(cart);

    const itemsTotalCents = this.computeItemsTotalCents(cart);
    const normalizedPromo = this.normalizePromoCode(params.promoCode);
    const shippingMethod = await this.shippingMethods.getMethod(
      params.shippingMethod,
      itemsTotalCents,
    );
    const baseTotals = this.calculateCartTotals(cart, shippingMethod);
    const appliedPromo = normalizedPromo
      ? await this.computePromoApplication(
          cart,
          shippingMethod,
          normalizedPromo,
          baseTotals,
          { userId },
        )
      : null;
    const discountCents = appliedPromo?.valid ? appliedPromo.discountCents : 0;
    const adjustedShippingMethod = await this.shippingMethods.getMethod(
      params.shippingMethod,
      itemsTotalCents,
      discountCents,
    );
    const totals = this.calculateCartTotals(
      cart,
      adjustedShippingMethod,
      discountCents,
    );
    if (appliedPromo && appliedPromo.valid) {
      appliedPromo.totalAfterCents = totals.totalCents;
    }
    const computation = this.buildCheckoutComputation(cart, {
      shippingCostCents: totals.shippingCents,
      itemsTotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
    });
    const summary = this.buildCheckoutSummary(computation);
    const lineItems = this.buildPublicLineItems(computation.lineItems);
    const metadata: CheckoutMetadata = {
      cartId: cart.id,
      userId,
      shippingMethod: adjustedShippingMethod.code,
      shippingCostCents: totals.shippingCents,
      itemsTotalCents: totals.subtotalCents,
    };
    if (appliedPromo?.valid && appliedPromo.code) {
      metadata.promoCode = appliedPromo.code;
      metadata.discountCents = totals.discountCents;
    }

    return {
      cart,
      computation,
      summary,
      lineItems,
      metadata,
      shippingMethod: {
        ...adjustedShippingMethod,
        amount: this.formatMoney(totals.shippingCents),
      },
      totals,
      appliedPromo,
    };
  }

  async createCheckoutSession(
    userId: number,
    dto: CreateCheckoutSessionDto,
    options: { cart?: CartSnapshot | null } = {},
  ): Promise<Record<string, unknown>> {
    const preview = await this.getCheckoutPreview(
      userId,
      {
        shippingMethod: dto.shippingMethod,
        promoCode: dto.couponCode,
      },
      { cart: options.cart },
    ); // [STRIPE]
    const provider = this.taxConfig.getPaymentProvider();

    const metadata: Record<string, unknown> = { ...preview.metadata };
    if (preview.appliedPromo?.code) {
      metadata.promoCode = preview.appliedPromo.code;
      metadata.discountCents = preview.appliedPromo.discountCents;
    } else if (dto.couponCode) {
      metadata.promoCode = dto.couponCode;
    }

    const response: Record<string, unknown> = {
      provider,
      summary: preview.summary,
      lineItems: preview.lineItems,
      metadata,
      shippingMethod: preview.shippingMethod,
      totals: preview.totals,
      appliedPromo: preview.appliedPromo ?? null,
    };

    if (dto.shippingAddress) {
      response.shippingAddress = dto.shippingAddress;
    }
    if (dto.billingAddress) {
      response.billingAddress = dto.billingAddress;
    }

    if (provider === 'stripe') {
      response.checkoutSessionId = `fake_${Date.now()}`;
    }

    return response;
  }

  /**
   * Freezes the exact checkout that will be charged before a PaymentIntent is
   * created. Order creation later reads only this snapshot, never the cart.
   */
  async createCheckoutSnapshot(
    userId: number,
    params: {
      shippingMethod: ShippingMethodCode;
      promoCode?: string;
      shippingAddress?: Record<string, unknown>;
      billingAddress?: Record<string, unknown>;
    },
    options: { cart?: CartSnapshot | null } = {},
  ): Promise<CheckoutSnapshotResponse> {
    const preview = await this.getCheckoutPreview(
      userId,
      {
        shippingMethod: params.shippingMethod,
        promoCode: params.promoCode,
      },
      { cart: options.cart },
    );
    const cartUpdatedAt = preview.cart.updatedAt;
    // Stripe does not create zero-value PaymentIntents. Reject before a
    // snapshot reserves inventory, rather than entering a retry/reset loop.
    if (preview.totals.totalCents <= 0) {
      throw new BadRequestException('ZERO_TOTAL_CHECKOUT_NOT_SUPPORTED');
    }
    const requestFingerprint = this.buildCheckoutRequestFingerprint(
      userId,
      preview,
      params,
    );
    const existing = await this.findActiveCheckoutSnapshot(
      userId,
      preview.cart.id,
    );

    if (existing) {
      return this.reuseActiveCheckoutSnapshot(
        existing,
        requestFingerprint,
        new Date(),
      );
    }

    try {
      const snapshot = await this.prisma.$transaction(async (tx) => {
        const currentCart = await tx.cart.findUnique({
          where: { id: preview.cart.id },
          select: { userId: true, updatedAt: true },
        });
        if (
          !currentCart ||
          currentCart.userId !== userId ||
          currentCart.updatedAt.getTime() !== cartUpdatedAt.getTime()
        ) {
          throw new ConflictException('CART_CHANGED_DURING_CHECKOUT');
        }

        const competing = await tx.checkoutSnapshot.findFirst({
          where: {
            userId,
            cartId: preview.cart.id,
            orderId: null,
            status: { in: ACTIVE_CHECKOUT_SNAPSHOT_STATUSES },
          },
          orderBy: { createdAt: 'desc' },
          include: { items: true },
        });
        if (competing) {
          return this.reuseActiveCheckoutSnapshot(
            competing,
            requestFingerprint,
            new Date(),
          );
        }

        const created = await tx.checkoutSnapshot.create({
          data: {
            userId,
            cartId: preview.cart.id,
            cartUpdatedAt,
            requestFingerprint,
            status: 'RESERVED',
            currency: preview.computation.currency,
            subtotalCents: preview.totals.subtotalCents,
            taxRate: preview.computation.taxRate,
            taxAmountCents: this.decimalToCents(preview.computation.taxAmount),
            shippingCostCents: preview.totals.shippingCents,
            shippingMethodId: preview.shippingMethod.id,
            shippingMethodCode: preview.shippingMethod.code,
            shippingMethodLabel: preview.shippingMethod.label,
            shippingMethodDescription:
              preview.shippingMethod.description ?? null,
            shippingMethodPriceCents: preview.shippingMethod.priceCents,
            discountCents: preview.totals.discountCents,
            promoCodeId: preview.appliedPromo?.promoId ?? null,
            promoCodeCode: preview.appliedPromo?.code ?? null,
            totalCents: preview.totals.totalCents,
            shippingAddr: this.toInputJsonValue(params.shippingAddress),
            billingAddr: this.toInputJsonValue(params.billingAddress),
            expiresAt: new Date(Date.now() + CHECKOUT_SNAPSHOT_TTL_MS),
            items: {
              create: preview.computation.lineItems.map((item) => ({
                productId: item.productId,
                variantId: item.variantId,
                title: item.title,
                unitPriceCents: this.decimalToCents(item.unitPrice),
                quantity: item.quantity,
                lineTotalCents: this.decimalToCents(item.lineTotal),
              })),
            },
          },
          include: { items: true },
        });

        await this.reserveStockForCheckoutSnapshot(
          tx,
          created.id,
          preview.computation.lineItems,
        );
        return created;
      });

      if ('reused' in snapshot) {
        return snapshot;
      }
      return this.buildCheckoutSnapshotResponse(snapshot, new Date(), false);
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }

      const concurrent = await this.findActiveCheckoutSnapshot(
        userId,
        preview.cart.id,
      );
      if (!concurrent) throw error;
      return this.reuseActiveCheckoutSnapshot(
        concurrent,
        requestFingerprint,
        new Date(),
      );
    }
  }
  async claimCheckoutPaymentIntentCreation(
    checkoutSnapshotId: string,
  ): Promise<boolean> {
    const result = await this.prisma.checkoutSnapshot.updateMany({
      where: {
        id: checkoutSnapshotId,
        stripePaymentIntentId: null,
        status: { in: ['RESERVED', 'PAYMENT_INTENT_CREATING'] },
        expiresAt: { gt: new Date() },
      },
      data: { status: 'PAYMENT_INTENT_CREATING' },
    });
    return result.count === 1;
  }

  async bindStripePaymentIntent(
    checkoutSnapshotId: string,
    paymentIntentId: string,
  ): Promise<void> {
    const updated = await this.prisma.checkoutSnapshot.updateMany({
      where: {
        id: checkoutSnapshotId,
        stripePaymentIntentId: null,
        status: 'PAYMENT_INTENT_CREATING',
        expiresAt: { gt: new Date() },
      },
      data: { stripePaymentIntentId: paymentIntentId, status: 'PAYMENT_BOUND' },
    });

    if (updated.count === 1) return;

    const snapshot = await this.prisma.checkoutSnapshot.findUnique({
      where: { id: checkoutSnapshotId },
      select: { stripePaymentIntentId: true, expiresAt: true },
    });
    if (snapshot?.stripePaymentIntentId === paymentIntentId) return;
    if (snapshot?.expiresAt && snapshot.expiresAt <= new Date()) {
      throw new BadRequestException('CHECKOUT_SNAPSHOT_EXPIRED');
    }
    throw new ConflictException('CHECKOUT_SNAPSHOT_ALREADY_BOUND');
  }

  async resetCheckoutPaymentIntentCreation(
    checkoutSnapshotId: string,
  ): Promise<void> {
    await this.prisma.checkoutSnapshot.updateMany({
      where: {
        id: checkoutSnapshotId,
        stripePaymentIntentId: null,
        status: 'PAYMENT_INTENT_CREATING',
        expiresAt: { gt: new Date() },
      },
      data: { status: 'RESERVED' },
    });
  }

  async claimCheckoutSnapshotReplacement(
    userId: number,
    cartId: number,
    checkoutSnapshotId: string,
  ): Promise<boolean> {
    const claimed = await this.prisma.checkoutSnapshot.updateMany({
      where: {
        id: checkoutSnapshotId,
        userId,
        cartId,
        orderId: null,
        status: { in: ['RESERVED', 'PAYMENT_BOUND'] },
      },
      data: { status: 'REPLACEMENT_PENDING' },
    });
    return claimed.count === 1;
  }

  async releaseCheckoutSnapshot(
    checkoutSnapshotId: string,
    terminalStatus:
      | 'EXPIRED'
      | 'REPLACED'
      | 'PAYMENT_CANCELLED'
      | 'PAYMENT_CREATION_FAILED',
    expectedPaymentIntentId?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const snapshot = await tx.checkoutSnapshot.findUnique({
        where: { id: checkoutSnapshotId },
        include: { items: true },
      });
      if (!snapshot || snapshot.orderId) return;
      if (
        expectedPaymentIntentId !== undefined &&
        snapshot.stripePaymentIntentId !== expectedPaymentIntentId
      ) {
        throw new ConflictException('CHECKOUT_SNAPSHOT_PAYMENT_MISMATCH');
      }
      if (!ACTIVE_CHECKOUT_SNAPSHOT_STATUSES.includes(snapshot.status)) {
        return;
      }

      await this.releaseStockReservationsForCheckoutSnapshot(tx, snapshot);
      await tx.checkoutSnapshot.update({
        where: { id: snapshot.id },
        data: { status: terminalStatus },
      });
    });
  }

  async releaseCheckoutSnapshotForCanceledPaymentIntent(
    paymentIntentId: string,
  ): Promise<void> {
    const snapshot = await this.prisma.checkoutSnapshot.findUnique({
      where: { stripePaymentIntentId: paymentIntentId },
      select: { id: true },
    });
    if (!snapshot) return;
    await this.releaseCheckoutSnapshot(
      snapshot.id,
      'PAYMENT_CANCELLED',
      paymentIntentId,
    );
  }

  async listExpiredCheckoutSnapshots(
    limit = 100,
  ): Promise<Array<{ id: string; stripePaymentIntentId: string | null }>> {
    return this.prisma.checkoutSnapshot.findMany({
      where: {
        orderId: null,
        expiresAt: { lte: new Date() },
        status: { in: EXPIRABLE_CHECKOUT_SNAPSHOT_STATUSES },
      },
      orderBy: { expiresAt: 'asc' },
      take: Math.max(1, Math.min(limit, 100)),
      select: { id: true, stripePaymentIntentId: true },
    });
  }

  async claimStripeWebhookEvent(
    input: StripeWebhookEventInput,
  ): Promise<boolean> {
    try {
      await this.prisma.stripeWebhookEvent.create({
        data: {
          id: input.id,
          type: input.type,
          paymentIntentId: input.paymentIntentId ?? null,
          lifecycleStatus: input.lifecycleStatus ?? null,
          amountCents: input.amountCents ?? null,
          status: 'PROCESSING',
          occurredAt: input.occurredAt,
        },
      });
      return true;
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error;
      }
    }

    const reclaimed = await this.prisma.stripeWebhookEvent.updateMany({
      where: {
        id: input.id,
        OR: [
          { status: 'FAILED' },
          {
            status: 'PROCESSING',
            updatedAt: { lt: new Date(Date.now() - WEBHOOK_EVENT_STALE_MS) },
          },
        ],
      },
      data: {
        status: 'PROCESSING',
        error: null,
        lifecycleStatus: input.lifecycleStatus ?? null,
        amountCents: input.amountCents ?? null,
        occurredAt: input.occurredAt,
      },
    });
    return reclaimed.count === 1;
  }

  async completeStripeWebhookEvent(eventId: string): Promise<void> {
    await this.prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSED', processedAt: new Date(), error: null },
    });
  }

  async failStripeWebhookEvent(eventId: string, error: unknown): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    await this.prisma.stripeWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'FAILED', error: reason.slice(0, 1000) },
    });
  }

  /**
   * This method has no HTTP controller. It is invoked only after the Stripe
   * webhook signature and PaymentIntent/snapshot binding have been checked.
   */
  async createOrderFromVerifiedStripePayment(input: {
    checkoutSnapshotId: string;
    paymentIntentId: string;
    amountCents: number;
    currency: string;
    occurredAt: Date;
  }): Promise<VerifiedStripeOrderResult> {
    const normalizedCurrency = input.currency.toUpperCase();

    let result: VerifiedStripeOrderResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const snapshot = await tx.checkoutSnapshot.findUnique({
          where: { id: input.checkoutSnapshotId },
          include: { items: true },
        });
        if (!snapshot)
          throw new NotFoundException('CHECKOUT_SNAPSHOT_NOT_FOUND');
        if (snapshot.stripePaymentIntentId !== input.paymentIntentId) {
          throw new BadRequestException('STRIPE_PAYMENT_SNAPSHOT_MISMATCH');
        }
        if (
          snapshot.totalCents !== input.amountCents ||
          snapshot.currency.toUpperCase() !== normalizedCurrency
        ) {
          throw new BadRequestException('STRIPE_PAYMENT_AMOUNT_MISMATCH');
        }
        if (input.occurredAt > snapshot.expiresAt) {
          throw new BadRequestException('STRIPE_PAYMENT_AFTER_CHECKOUT_EXPIRY');
        }

        const existing = await tx.order.findUnique({
          where: { providerRef: input.paymentIntentId },
          include: { items: true },
        });
        if (existing) {
          return {
            orderId: existing.id,
            userId: existing.userId,
            checkoutSnapshotId: snapshot.id,
            created: false,
            status: existing.status,
          };
        }

        const lifecycleStatus = await this.resolvePersistedPaymentLifecycle(
          tx,
          input.paymentIntentId,
        );
        const promo = snapshot.promoCodeId
          ? await tx.promoCode.findUnique({
              where: { id: snapshot.promoCodeId },
              select: { id: true },
            })
          : null;

        const order = await tx.order.create({
          data: {
            userId: snapshot.userId,
            status: lifecycleStatus,
            subtotal: this.centsToDecimal(snapshot.subtotalCents),
            taxRate: snapshot.taxRate,
            taxAmount: this.centsToDecimal(snapshot.taxAmountCents),
            shippingCost: snapshot.shippingCostCents,
            shippingMethodId: snapshot.shippingMethodId,
            shippingMethodCode: snapshot.shippingMethodCode,
            discountCents: snapshot.discountCents,
            disputeLostCents: snapshot.disputeLostCents,
            promoCodeId: promo?.id ?? null,
            promoCodeCode: snapshot.promoCodeCode,
            total: this.centsToDecimal(snapshot.totalCents),
            currency: snapshot.currency,
            provider: 'stripe',
            providerRef: input.paymentIntentId,
            shippingAddr: this.toInputJsonValue(snapshot.shippingAddr),
            billingAddr: this.toInputJsonValue(snapshot.billingAddr),
          },
        });

        await tx.orderItem.createMany({
          data: snapshot.items.map((item) => ({
            orderId: order.id,
            productId: item.productId,
            title: item.title,
            unitPrice: this.centsToDecimal(item.unitPriceCents),
            quantity: item.quantity,
            lineTotal: this.centsToDecimal(item.lineTotalCents),
          })),
        });
        const created = await tx.order.findUnique({
          where: { id: order.id },
          include: { items: true },
        });
        if (!created)
          throw new NotFoundException('ORDER_NOT_FOUND_AFTER_CREATE');

        if (lifecycleStatus === OrderStatus.PAID) {
          await this.consumeStockReservationsForCheckoutSnapshot(
            tx,
            created.id,
            snapshot,
          );
          await this.clearCartIfSnapshotStillCurrent(tx, snapshot);
          await this.fillMissingUserNames(
            tx,
            snapshot.userId,
            this.extractNames(snapshot.shippingAddr),
            this.extractNames(snapshot.billingAddr),
          );
          await this.historialService.incrementOrderProgress(
            snapshot.userId,
            this.computeOrderItemsQuantity(created.items),
            tx,
          );
          await this.handlePromoUsageOnPaid(tx, created);
        } else if (lifecycleStatus === OrderStatus.REFUNDED) {
          await this.releaseStockReservationsForCheckoutSnapshot(tx, snapshot);
        }

        await tx.checkoutSnapshot.update({
          where: { id: snapshot.id },
          data: {
            orderId: order.id,
            status:
              lifecycleStatus === OrderStatus.PAID
                ? 'ORDER_CREATED'
                : lifecycleStatus,
          },
        });

        return {
          orderId: created.id,
          userId: snapshot.userId,
          checkoutSnapshotId: snapshot.id,
          created: true,
          status: created.status,
        };
      });
    } catch (error) {
      // A stale Stripe event may be reclaimed while the original worker is
      // still committing. providerRef is unique, so a losing concurrent
      // create is a duplicate fulfillment, not a reason to compensate/refund
      // a payment the winning worker successfully created.
      if (!this.isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.order.findUnique({
        where: { providerRef: input.paymentIntentId },
        select: { id: true, userId: true, status: true },
      });
      if (!existing) throw error;
      result = {
        orderId: existing.id,
        userId: existing.userId,
        checkoutSnapshotId: input.checkoutSnapshotId,
        created: false,
        status: existing.status,
      };
    }

    // A refund/dispute can be claimed after the transaction resolved its event
    // ledger but before the paid order commit became visible. Reconcile again
    // after commit so a signed concurrent lifecycle event cannot be stranded.
    await this.reconcileStripePaymentLifecycle(input.paymentIntentId);
    const reconciled = await this.prisma.order.findUnique({
      where: { id: result.orderId },
      select: { status: true },
    });
    return {
      ...result,
      status: reconciled?.status ?? result.status,
    };
  }

  async applyStripePaymentLifecycle(
    paymentIntentId: string,
    targetStatus: StripeLifecycleStatus,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.applyStripePaymentLifecycleInTransaction(
        tx,
        paymentIntentId,
        targetStatus,
      );
    });
  }

  /**
   * Stripe can deliver related dispute events out of order. Re-resolve the
   * persisted event ledger by Stripe's occurredAt timestamp instead of using
   * the event currently being delivered as the lifecycle source of truth.
   */
  async reconcileStripePaymentLifecycle(
    paymentIntentId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const targetStatus = await this.resolvePersistedPaymentLifecycle(
        tx,
        paymentIntentId,
      );
      await this.applyStripePaymentLifecycleInTransaction(
        tx,
        paymentIntentId,
        targetStatus,
      );
    });
  }

  /**
   * A closed lost Stripe dispute is not necessarily a full refund. Aggregate
   * the signed amounts of distinct claimed loss events, cap them at the frozen
   * checkout total, and persist that non-additive aggregate. The caller then
   * reconciles the derived lifecycle, including loss-before-success delivery.
   */
  async recordStripeClosedLostDispute(input: {
    eventId: string;
    paymentIntentId: string;
    amountCents: number;
  }): Promise<'FULL' | 'PARTIAL' | 'IGNORED'> {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
      return 'IGNORED';
    }

    return this.prisma.$transaction(async (tx) => {
      const snapshotRef = await tx.checkoutSnapshot.findUnique({
        where: { stripePaymentIntentId: input.paymentIntentId },
        select: { id: true },
      });
      if (!snapshotRef) {
        return 'IGNORED';
      }

      // Serialize concurrent closed-loss handlers on the snapshot row before
      // querying the event ledger. Without this lock, two different disputes
      // can each read a partial total and overwrite one another.
      await tx.checkoutSnapshot.update({
        where: { id: snapshotRef.id },
        data: { updatedAt: new Date() },
      });
      const snapshot = await tx.checkoutSnapshot.findUnique({
        where: { id: snapshotRef.id },
        select: {
          id: true,
          orderId: true,
          status: true,
          totalCents: true,
        },
      });
      if (!snapshot || snapshot.status === OrderStatus.REFUNDED) {
        return 'IGNORED';
      }

      // The signed event was already claimed before this method runs. Retain
      // its exact amount; event IDs make the following aggregate replay-safe.
      const updatedEvent = await tx.stripeWebhookEvent.updateMany({
        where: { id: input.eventId, paymentIntentId: input.paymentIntentId },
        data: {
          amountCents: input.amountCents,
        },
      });
      if (updatedEvent.count !== 1) {
        throw new ConflictException('STRIPE_WEBHOOK_EVENT_NOT_CLAIMED');
      }

      const lossEvents = await tx.stripeWebhookEvent.findMany({
        where: {
          paymentIntentId: input.paymentIntentId,
          type: 'charge.dispute.closed',
          amountCents: { not: null },
        },
        select: { amountCents: true },
      });
      let lossCents = 0;
      for (const event of lossEvents) {
        const amount = event.amountCents ?? 0;
        if (!Number.isSafeInteger(amount) || amount <= 0) continue;
        lossCents = Math.min(snapshot.totalCents, lossCents + amount);
      }
      const fullLoss = lossCents >= snapshot.totalCents;
      const eventLifecycleStatus = fullLoss
        ? OrderStatus.REFUNDED
        : OrderStatus.PAID;
      await tx.stripeWebhookEvent.update({
        where: { id: input.eventId },
        data: { lifecycleStatus: eventLifecycleStatus },
      });

      await tx.checkoutSnapshot.update({
        where: { id: snapshot.id },
        data: { disputeLostCents: lossCents },
      });
      if (snapshot.orderId) {
        await tx.order.updateMany({
          where: { id: snapshot.orderId },
          data: { disputeLostCents: lossCents },
        });
      }

      return fullLoss ? 'FULL' : 'PARTIAL';
    });
  }

  private async applyStripePaymentLifecycleInTransaction(
    tx: Prisma.TransactionClient,
    paymentIntentId: string,
    targetStatus: StripeLifecycleStatus,
  ): Promise<void> {
    const order = await tx.order.findUnique({
      where: { providerRef: paymentIntentId },
      include: { items: true },
    });

    // A signed terminal event can arrive before payment_intent.succeeded.
    // Keep a dispute reservation, but release an unfulfilled full refund.
    if (!order) {
      const snapshot = await tx.checkoutSnapshot.findUnique({
        where: { stripePaymentIntentId: paymentIntentId },
        include: { items: true },
      });
      if (!snapshot) return;

      if (targetStatus === OrderStatus.REFUNDED) {
        await this.releaseStockReservationsForCheckoutSnapshot(tx, snapshot);
        await tx.checkoutSnapshot.update({
          where: { id: snapshot.id },
          data: { status: OrderStatus.REFUNDED },
        });
      } else if (targetStatus === OrderStatus.DISPUTED) {
        await tx.checkoutSnapshot.updateMany({
          where: { id: snapshot.id, orderId: null },
          data: { status: OrderStatus.DISPUTED },
        });
      }
      return;
    }

    const snapshot = await tx.checkoutSnapshot.findUnique({
      where: { orderId: order.id },
      include: { items: true },
    });

    if (targetStatus === OrderStatus.REFUNDED) {
      // A previous direct admin update may already have set REFUNDED while
      // leaving a consumed reservation behind. Always repair stock first;
      // the reservation claim makes both stock and history idempotent.
      const returnedStock = snapshot
        ? await this.returnConsumedStockReservationsForRefund(
            tx,
            order.id,
            snapshot,
          )
        : false;
      if (snapshot) {
        await this.releaseStockReservationsForCheckoutSnapshot(tx, snapshot);
      }

      const wasRefunded = order.status === OrderStatus.REFUNDED;
      const updated = wasRefunded
        ? order
        : await tx.order.update({
            where: { id: order.id },
            data: {
              status: OrderStatus.REFUNDED,
              preDisputeStatus: null,
            },
            include: { items: true },
          });

      const legacyCompletedOrder =
        !snapshot &&
        !wasRefunded &&
        (this.isCompletedOrderStatus(order.status) ||
          (order.status === OrderStatus.DISPUTED &&
            !!order.preDisputeStatus &&
            this.isCompletedOrderStatus(order.preDisputeStatus)));
      if (returnedStock || legacyCompletedOrder) {
        await this.historialService.registerReturn(
          updated.userId,
          this.computeOrderItemsQuantity(updated.items),
          tx,
        );
      }

      await tx.checkoutSnapshot.updateMany({
        where: { orderId: order.id },
        data: { status: OrderStatus.REFUNDED },
      });
      return;
    }

    // A refund is terminal. Do not let a stale dispute/reinstatement change
    // a locally reconciled full refund.
    if (order.status === OrderStatus.REFUNDED) return;

    if (targetStatus === OrderStatus.DISPUTED) {
      if (order.status === OrderStatus.DISPUTED) return;

      await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.DISPUTED,
          preDisputeStatus: order.status,
        },
      });
      await tx.checkoutSnapshot.updateMany({
        where: { orderId: order.id },
        data: { status: OrderStatus.DISPUTED },
      });
      return;
    }

    // A reinstated/won dispute must restore fulfillment progress. If the
    // original successful event had not yet consumed the reservation, consume
    // it now; otherwise leave already-consumed stock untouched.
    if (order.status !== OrderStatus.DISPUTED) return;
    if (!snapshot) throw new NotFoundException('CHECKOUT_SNAPSHOT_NOT_FOUND');

    const consumedNow = await this.consumeStockReservationsForCheckoutSnapshot(
      tx,
      order.id,
      snapshot,
    );
    const restoredStatus = order.preDisputeStatus ?? OrderStatus.PAID;
    const restored = await tx.order.update({
      where: { id: order.id },
      data: { status: restoredStatus, preDisputeStatus: null },
      include: { items: true },
    });
    if (consumedNow) {
      await this.clearCartIfSnapshotStillCurrent(tx, snapshot);
      await this.historialService.incrementOrderProgress(
        restored.userId,
        this.computeOrderItemsQuantity(restored.items),
        tx,
      );
      await this.handlePromoUsageOnPaid(tx, restored, OrderStatus.DISPUTED);
    }
    await tx.checkoutSnapshot.update({
      where: { id: snapshot.id },
      data: { status: 'ORDER_CREATED' },
    });
  }
  async claimOrderConfirmationEmail(
    checkoutSnapshotId: string,
  ): Promise<boolean> {
    const result = await this.prisma.checkoutSnapshot.updateMany({
      where: {
        id: checkoutSnapshotId,
        confirmationEmailSentAt: null,
        OR: [
          { confirmationEmailClaimedAt: null },
          {
            confirmationEmailClaimedAt: {
              lt: new Date(Date.now() - CONFIRMATION_EMAIL_CLAIM_STALE_MS),
            },
          },
        ],
      },
      data: { confirmationEmailClaimedAt: new Date() },
    });
    return result.count === 1;
  }

  async markOrderConfirmationEmailSent(
    checkoutSnapshotId: string,
  ): Promise<void> {
    await this.prisma.checkoutSnapshot.update({
      where: { id: checkoutSnapshotId },
      data: { confirmationEmailSentAt: new Date() },
    });
  }

  async releaseOrderConfirmationEmailClaim(
    checkoutSnapshotId: string,
  ): Promise<void> {
    await this.prisma.checkoutSnapshot.updateMany({
      where: { id: checkoutSnapshotId, confirmationEmailSentAt: null },
      data: { confirmationEmailClaimedAt: null },
    });
  }

  async getPaymentProcessingStatus(
    userId: number,
    providerRef?: string,
  ): Promise<Record<string, unknown>> {
    const normalizedProviderRef = String(providerRef ?? '').trim();

    if (!normalizedProviderRef) {
      throw new BadRequestException('PROVIDER_REF_REQUIRED');
    }

    const order = await this.prisma.order.findFirst({
      where: {
        userId,
        providerRef: normalizedProviderRef,
      },
      select: {
        id: true,
        status: true,
        providerRef: true,
        updatedAt: true,
      },
    });

    if (!order) {
      return {
        providerRef: normalizedProviderRef,
        found: false,
        isProcessed: false,
      };
    }

    const isProcessed =
      order.status === OrderStatus.PAID ||
      order.status === OrderStatus.PROCESSING ||
      order.status === OrderStatus.REFUNDED ||
      order.status === OrderStatus.SHIPPED ||
      order.status === OrderStatus.DELIVERED;

    return {
      providerRef: order.providerRef,
      found: true,
      orderId: order.id,
      orderStatus: order.status,
      isProcessed,
      updatedAt: order.updatedAt,
    };
  }

  async listOrders(
    user: AuthenticatedUser,
    pagination: PaginationDto,
  ): Promise<{
    data: Record<string, unknown>[];
    meta: Record<string, number>;
  }> {
    const page = pagination.page ?? 1;
    const requestedPageSize = pagination.pageSize ?? 20;
    const pageSize = Math.min(requestedPageSize, 100);
    const skip = (page - 1) * pageSize;

    const orderBy = this.resolveOrderBy(pagination.sort, pagination.order);

    const canAccessAll = hasAnyRole(user.role, [
      Role.SUPER_ADMIN,
      Role.LOGISTICS,
    ]);
    const where = canAccessAll ? {} : { userId: user.id };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        include: { items: true },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      data: orders.map((order) => this.serializeOrder(order)),
      meta: {
        page,
        pageSize,
        total,
      },
    };
  }

  async getOrderById(
    user: AuthenticatedUser,
    orderId: number,
  ): Promise<Record<string, unknown>> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundException('ORDER_NOT_FOUND');
    }

    const isOwner = order.userId === user.id;
    const canAccessAll = hasAnyRole(user.role, [
      Role.SUPER_ADMIN,
      Role.LOGISTICS,
    ]);
    if (!canAccessAll && !isOwner) {
      throw new ForbiddenException('ACCESS_DENIED');
    }

    return this.serializeOrder(order);
  }

  private async resolvePersistedPaymentLifecycle(
    tx: Prisma.TransactionClient,
    paymentIntentId: string,
  ): Promise<StripeLifecycleStatus> {
    const events = await tx.stripeWebhookEvent.findMany({
      where: {
        paymentIntentId,
        lifecycleStatus: { not: null },
      },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: { lifecycleStatus: true, occurredAt: true, type: true },
    });

    // Every row here was signature-verified before it was persisted. A FAILED
    // processing attempt is still authoritative Stripe lifecycle evidence and
    // must not be ignored while waiting for its retry.
    // A refund is terminal even if a later unrelated event is delivered after
    // it. This specifically handles refund-before-success delivery order.
    if (
      events.some((event) => event.lifecycleStatus === OrderStatus.REFUNDED)
    ) {
      return OrderStatus.REFUNDED;
    }

    const latestOccurredAt = events[0]?.occurredAt.getTime();
    const latestEvents =
      latestOccurredAt === undefined
        ? []
        : events.filter(
            (event) => event.occurredAt.getTime() === latestOccurredAt,
          );

    // Stripe Event.created has second precision. If a stale dispute and its
    // closing/reinstating event share a second, do not fall back to database
    // delivery order: a verified PAID resolution wins over DISPUTED.
    if (
      latestEvents.some((event) => event.lifecycleStatus === OrderStatus.PAID)
    ) {
      return OrderStatus.PAID;
    }
    if (
      latestEvents.some(
        (event) => event.lifecycleStatus === OrderStatus.DISPUTED,
      )
    ) {
      return OrderStatus.DISPUTED;
    }
    return OrderStatus.PAID;
  }

  private async clearCartIfSnapshotStillCurrent(
    tx: Prisma.TransactionClient,
    snapshot: CheckoutSnapshotWithItems,
  ): Promise<void> {
    // Lock the server-owned cart row inside the fulfillment transaction. Cart
    // writes serialize behind this update, so subtraction and total
    // recalculation cannot race a concurrent customer edit.
    const cartClaim = await tx.cart.updateMany({
      where: { id: snapshot.cartId, userId: snapshot.userId },
      data: { updatedAt: new Date() },
    });
    if (cartClaim.count !== 1) return;

    const purchasedByVariant = new Map<number, number>();
    for (const item of snapshot.items) {
      purchasedByVariant.set(
        item.variantId,
        (purchasedByVariant.get(item.variantId) ?? 0) + item.quantity,
      );
    }

    const currentItems = await tx.cartItem.findMany({
      where: { cartId: snapshot.cartId },
      select: { id: true, variantId: true, qty: true, priceAtAdd: true },
    });
    for (const item of currentItems) {
      const purchasedQuantity = purchasedByVariant.get(item.variantId) ?? 0;
      if (purchasedQuantity <= 0) continue;

      const remainingQuantity = Math.max(0, item.qty - purchasedQuantity);
      if (remainingQuantity === 0) {
        await tx.cartItem.delete({ where: { id: item.id } });
      } else {
        await tx.cartItem.update({
          where: { id: item.id },
          data: { qty: remainingQuantity },
        });
      }
    }

    const remainingItems = await tx.cartItem.findMany({
      where: { cartId: snapshot.cartId },
      select: { qty: true, priceAtAdd: true },
    });
    await tx.cart.update({
      where: { id: snapshot.cartId },
      data: {
        itemsCount: remainingItems.reduce((sum, item) => sum + item.qty, 0),
        subtotal: remainingItems.reduce(
          (sum, item) => sum + item.qty * item.priceAtAdd,
          0,
        ),
      },
    });
  }

  private async findActiveCheckoutSnapshot(
    userId: number,
    cartId: number,
  ): Promise<CheckoutSnapshotWithItems | null> {
    return this.prisma.checkoutSnapshot.findFirst({
      where: {
        userId,
        cartId,
        orderId: null,
        status: { in: ACTIVE_CHECKOUT_SNAPSHOT_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true },
    });
  }

  private reuseActiveCheckoutSnapshot(
    snapshot: CheckoutSnapshotWithItems,
    requestFingerprint: string,
    now: Date,
  ): CheckoutSnapshotResponse {
    const replacementRequired =
      snapshot.status === 'REPLACEMENT_PENDING' ||
      snapshot.expiresAt <= now ||
      snapshot.requestFingerprint !== requestFingerprint;
    return this.buildCheckoutSnapshotResponse(
      snapshot,
      now,
      true,
      replacementRequired,
    );
  }

  private buildCheckoutSnapshotResponse(
    snapshot: CheckoutSnapshotWithItems,
    now: Date,
    reused: boolean,
    replacementRequired = false,
  ): CheckoutSnapshotResponse {
    const shippingCostCents = snapshot.shippingCostCents;
    const shippingMethod: ShippingMethodPublic = {
      id: snapshot.shippingMethodId ?? 0,
      code: snapshot.shippingMethodCode as ShippingMethodCode,
      label: snapshot.shippingMethodLabel ?? snapshot.shippingMethodCode ?? '',
      priceCents: snapshot.shippingMethodPriceCents ?? shippingCostCents,
      amountCents: shippingCostCents,
      description: snapshot.shippingMethodDescription,
      amount: this.formatMoney(shippingCostCents),
    };

    return {
      checkoutSnapshotId: snapshot.id,
      cartId: snapshot.cartId,
      amountCents: snapshot.totalCents,
      currency: snapshot.currency,
      summary: {
        currency: snapshot.currency,
        subtotal: this.formatMoney(snapshot.subtotalCents),
        taxRate: this.formatRate(snapshot.taxRate),
        taxAmount: this.formatMoney(snapshot.taxAmountCents),
        shippingCost: this.formatMoney(shippingCostCents),
        discount: this.formatMoney(-snapshot.discountCents),
        total: this.formatMoney(snapshot.totalCents),
      },
      lineItems: snapshot.items.map((item) => ({
        productId: item.productId,
        title: item.title,
        quantity: item.quantity,
        unitPrice: this.formatMoney(item.unitPriceCents),
        lineTotal: this.formatMoney(item.lineTotalCents),
      })),
      shippingMethod,
      totals: {
        subtotalCents: snapshot.subtotalCents,
        shippingCents: shippingCostCents,
        discountCents: snapshot.discountCents,
        totalCents: snapshot.totalCents,
      },
      paymentIntentId: snapshot.stripePaymentIntentId,
      status: snapshot.status,
      expiresAt: snapshot.expiresAt,
      reused,
      expired: snapshot.expiresAt <= now,
      replacementRequired,
    };
  }

  private buildCheckoutRequestFingerprint(
    userId: number,
    preview: CheckoutPreview,
    params: {
      shippingMethod: ShippingMethodCode;
      promoCode?: string;
      shippingAddress?: Record<string, unknown>;
      billingAddress?: Record<string, unknown>;
    },
  ): string {
    const fingerprintInput = {
      userId,
      cartId: preview.cart.id,
      cartUpdatedAt: preview.cart.updatedAt.toISOString(),
      shippingMethod: preview.shippingMethod.code,
      promoCode:
        preview.appliedPromo?.valid && preview.appliedPromo.code
          ? preview.appliedPromo.code
          : this.normalizePromoCode(params.promoCode),
      shippingAddress: this.canonicalizeJsonValue(params.shippingAddress),
      billingAddress: this.canonicalizeJsonValue(params.billingAddress),
    };
    return createHash('sha256')
      .update(JSON.stringify(fingerprintInput))
      .digest('hex');
  }

  private canonicalizeJsonValue(value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.canonicalizeJsonValue(entry));
    }
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, this.canonicalizeJsonValue(entry)]),
      );
    }
    return String(value);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private async reserveStockForCheckoutSnapshot(
    tx: Prisma.TransactionClient,
    checkoutSnapshotId: string,
    lineItems: CheckoutLineItem[],
  ): Promise<void> {
    const quantities = new Map<number, number>();
    for (const item of lineItems) {
      quantities.set(
        item.variantId,
        (quantities.get(item.variantId) ?? 0) + item.quantity,
      );
    }

    for (const [variantId, quantity] of quantities) {
      if (!Number.isInteger(quantity) || quantity <= 0) {
        throw new BadRequestException('INVALID_CART_ITEM_QUANTITY');
      }

      const updated = await tx.productVariant.updateMany({
        where: {
          id: variantId,
          isActive: true,
          product: { is: { isActive: true } },
          ...(this.allowNegativeStock ? {} : { stockQty: { gte: quantity } }),
        },
        data: { stockQty: { decrement: quantity } },
      });
      if (updated.count !== 1) {
        throw new ConflictException('INSUFFICIENT_STOCK_AT_CHECKOUT');
      }

      await tx.checkoutStockReservation.create({
        data: {
          checkoutSnapshotId,
          variantId,
          quantity,
          status: 'RESERVED',
        },
      });
      await tx.stockMovement.create({
        data: {
          variantId,
          delta: -quantity,
          reason: 'checkout_reservation',
          checkoutSnapshotId,
        },
      });
    }
  }

  private async consumeStockReservationsForCheckoutSnapshot(
    tx: Prisma.TransactionClient,
    orderId: number,
    snapshot: CheckoutSnapshotWithItems,
  ): Promise<boolean> {
    const reservations = await tx.checkoutStockReservation.findMany({
      where: { checkoutSnapshotId: snapshot.id },
      select: { id: true, variantId: true, quantity: true, status: true },
    });
    const expected = new Map<number, number>();
    for (const item of snapshot.items) {
      expected.set(
        item.variantId,
        (expected.get(item.variantId) ?? 0) + item.quantity,
      );
    }
    if (
      reservations.length !== expected.size ||
      reservations.some(
        (reservation) =>
          expected.get(reservation.variantId) !== reservation.quantity,
      )
    ) {
      throw new ConflictException('CHECKOUT_STOCK_RESERVATION_MISSING');
    }

    const statuses = new Set(
      reservations.map((reservation) => reservation.status),
    );
    if (statuses.size === 1 && statuses.has('CONSUMED')) {
      return false;
    }
    if (statuses.size !== 1 || !statuses.has('RESERVED')) {
      throw new ConflictException('CHECKOUT_STOCK_RESERVATION_UNAVAILABLE');
    }

    for (const reservation of reservations) {
      const claimed = await tx.checkoutStockReservation.updateMany({
        where: { id: reservation.id, status: 'RESERVED' },
        data: { status: 'CONSUMED', consumedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new ConflictException('CHECKOUT_STOCK_RESERVATION_UNAVAILABLE');
      }
    }

    const movements = await tx.stockMovement.updateMany({
      where: {
        checkoutSnapshotId: snapshot.id,
        orderId: null,
        reason: 'checkout_reservation',
      },
      data: { orderId, reason: 'order' },
    });
    if (movements.count !== reservations.length) {
      throw new ConflictException('CHECKOUT_STOCK_RESERVATION_MISSING');
    }
    return true;
  }

  private async releaseStockReservationsForCheckoutSnapshot(
    tx: Prisma.TransactionClient,
    snapshot: CheckoutSnapshotWithItems,
  ): Promise<void> {
    const reservations = await tx.checkoutStockReservation.findMany({
      where: { checkoutSnapshotId: snapshot.id, status: 'RESERVED' },
      select: { id: true, variantId: true, quantity: true },
    });

    for (const reservation of reservations) {
      const claimed = await tx.checkoutStockReservation.updateMany({
        where: { id: reservation.id, status: 'RESERVED' },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
      if (claimed.count !== 1) continue;

      await tx.productVariant.update({
        where: { id: reservation.variantId },
        data: { stockQty: { increment: reservation.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          variantId: reservation.variantId,
          delta: reservation.quantity,
          reason: 'checkout_reservation_release',
          checkoutSnapshotId: snapshot.id,
        },
      });
    }
  }

  /**
   * A full refund returns stock that was already consumed by a paid order.
   * This is intentionally distinct from releasing an uncharged reservation:
   * CONSUMED -> RETURNED is claimed per row so Stripe retries and an admin
   * refund/webhook race cannot increment inventory twice.
   */
  private async returnConsumedStockReservationsForRefund(
    tx: Prisma.TransactionClient,
    orderId: number,
    snapshot: CheckoutSnapshotWithItems,
  ): Promise<boolean> {
    // Claim the complete return before touching individual reservation rows.
    // This also gates Historial.registerReturn, whose aggregate update is not
    // itself idempotent when an admin action races a Stripe webhook.
    const claimedSnapshot = await tx.checkoutSnapshot.updateMany({
      where: { id: snapshot.id, stockReturnedAt: null },
      data: { stockReturnedAt: new Date() },
    });
    if (claimedSnapshot.count !== 1) return false;

    const reservations = await tx.checkoutStockReservation.findMany({
      where: { checkoutSnapshotId: snapshot.id, status: 'CONSUMED' },
      select: { id: true, variantId: true, quantity: true },
    });

    let returnedAny = false;
    for (const reservation of reservations) {
      const claimed = await tx.checkoutStockReservation.updateMany({
        where: { id: reservation.id, status: 'CONSUMED' },
        data: { status: 'RETURNED', returnedAt: new Date() },
      });
      if (claimed.count !== 1) continue;

      await tx.productVariant.update({
        where: { id: reservation.variantId },
        data: { stockQty: { increment: reservation.quantity } },
      });
      await tx.stockMovement.create({
        data: {
          variantId: reservation.variantId,
          delta: reservation.quantity,
          reason: 'refund',
          orderId,
          checkoutSnapshotId: snapshot.id,
        },
      });
      returnedAny = true;
    }

    return returnedAny;
  }

  private isCompletedOrderStatus(status: OrderStatus): boolean {
    const completedStatuses: OrderStatus[] = [
      OrderStatus.PAID,
      OrderStatus.PROCESSING,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
    ];
    return completedStatuses.includes(status);
  }

  private buildCheckoutSummary(
    computation: CheckoutComputation,
  ): CheckoutSummaryResponse {
    // [STRIPE]
    return {
      currency: computation.currency,
      subtotal: this.formatMoney(computation.subtotal),
      taxRate: this.formatRate(computation.taxRate),
      taxAmount: this.formatMoney(computation.taxAmount),
      shippingCost: this.formatMoney(computation.shippingCost),
      discount: this.formatMoney(computation.discount.mul(-1)),
      total: this.formatMoney(computation.total),
    };
  }

  private buildPublicLineItems(
    lineItems: CheckoutLineItem[],
  ): CheckoutLineItemResponse[] {
    // [STRIPE]
    return lineItems.map((item) => ({
      productId: item.productId,
      title: item.title,
      quantity: item.quantity,
      unitPrice: this.formatMoney(item.unitPrice),
      lineTotal: this.formatMoney(item.lineTotal),
    }));
  }

  calculateCartTotals(
    cart: CartSnapshot | null,
    shippingMethod: ShippingMethodOption | null,
    discountCents = 0,
  ): CheckoutTotals {
    const subtotalCents = this.computeItemsTotalCents(cart);
    const safeDiscount = Math.max(0, Math.min(discountCents, subtotalCents));
    const netItemsCents = Math.max(0, subtotalCents - safeDiscount);
    let shippingCents = 0;

    if (shippingMethod) {
      const anyMethod = shippingMethod as any;
      const rawPrice =
        typeof anyMethod.price === 'number' ? anyMethod.price : 0;
      const baseShipping =
        (typeof anyMethod.priceCents === 'number' && anyMethod.priceCents) ??
        rawPrice ??
        0;
      const candidateAmount =
        (typeof anyMethod.amountCents === 'number' && anyMethod.amountCents) ??
        baseShipping;

      if (
        anyMethod.code === ShippingMethodCode.STANDARD &&
        netItemsCents >= FREE_SHIPPING_THRESHOLD_CENTS
      ) {
        shippingCents = 0;
      } else {
        shippingCents = candidateAmount;
      }
    }

    const totalCents = Math.max(0, netItemsCents + shippingCents);

    return {
      subtotalCents,
      shippingCents,
      discountCents: safeDiscount,
      totalCents,
    };
  }

  private normalizePromoCode(code?: string | null): string | null {
    if (!code || typeof code !== 'string') return null;
    const normalized = code.replace(/\s+/g, '').toUpperCase();
    return normalized || null;
  }

  private async computePromoApplication(
    _cart: CartSnapshot,
    _shippingMethod: ShippingMethodOption,
    promoCode: string,
    baseTotals: CheckoutTotals,
    options: { userId?: number; client?: PrismaClientOrTx } = {},
  ): Promise<PromoApplication> {
    const client = options.client ?? this.prisma;
    const code = this.normalizePromoCode(promoCode);
    const itemsTotalCents = baseTotals.subtotalCents;
    const shippingCents = baseTotals.shippingCents;
    const totalBeforeCents = Math.max(0, itemsTotalCents + shippingCents);

    if (!code) {
      return {
        valid: false,
        discountCents: 0,
        totalBeforeCents,
        totalAfterCents: totalBeforeCents,
        message: 'Este código de descuento no existe',
      };
    }

    const promo = await client.promoCode.findFirst({
      where: { code },
      select: {
        id: true,
        code: true,
        type: true,
        value: true,
        minCartValue: true,
        startsAt: true,
        expiresAt: true,
        isActive: true,
        usageLimit: true,
        usageCount: true,
      },
    });

    const invalidResponse = (message: string): PromoApplication => ({
      valid: false,
      code,
      discountCents: 0,
      totalBeforeCents,
      totalAfterCents: totalBeforeCents,
      message,
    });

    if (!promo) {
      return invalidResponse('Este código de descuento no existe');
    }

    const validation = await this.validatePromoAvailability(promo, {
      userId: options.userId,
      client,
    });

    if (!validation.valid) {
      return invalidResponse(validation.message ?? 'Este código no es válido');
    }

    const minValue = promo.minCartValue ?? null;
    if (minValue && itemsTotalCents < minValue) {
      const minLabel = this.formatMoney(this.centsToDecimal(minValue));
      return invalidResponse(`Compra mínima: ${minLabel}`);
    }

    const baseAmountCents = itemsTotalCents;
    let discountCents = 0;

    if (promo.type === PromoCodeType.PERCENT) {
      discountCents = Math.floor((baseAmountCents * promo.value) / 100);
    } else {
      discountCents = promo.value;
    }

    discountCents = Math.max(0, Math.min(discountCents, baseAmountCents));
    const totalsAfterPromo = this.calculateCartTotals(
      _cart,
      _shippingMethod,
      discountCents,
    );
    const netItemsCents = Math.max(
      0,
      totalsAfterPromo.subtotalCents - totalsAfterPromo.discountCents,
    );
    const totalAfterCents = Math.max(0, totalsAfterPromo.totalCents);

    const discountLineLabel =
      promo.type === PromoCodeType.PERCENT
        ? `-${promo.value}% (${this.formatMoney(this.centsToDecimal(discountCents))})`
        : `-${this.formatMoney(this.centsToDecimal(discountCents))}`;

    return {
      valid: true,
      code,
      promoId: promo.id,
      discountCents,
      totalBeforeCents,
      totalAfterCents,
      discountLineLabel,
      message: 'Código aplicado',
    };
  }

  private async validatePromoAvailability(
    promo: {
      id: number;
      startsAt: Date | null;
      expiresAt: Date | null;
      isActive: boolean;
      usageLimit: number | null;
      usageCount: number;
    },
    options: { userId?: number; client?: PrismaClientOrTx } = {},
  ): Promise<{ valid: boolean; message?: string }> {
    const now = new Date();

    if (!promo.isActive) {
      return { valid: false, message: 'Código caducado' };
    }

    if (promo.startsAt && promo.startsAt > now) {
      return { valid: false, message: 'Aún no disponible' };
    }

    if (promo.expiresAt && promo.expiresAt < now) {
      return { valid: false, message: 'Código caducado' };
    }

    if (promo.usageLimit != null && promo.usageCount >= promo.usageLimit) {
      return { valid: false, message: 'Límite de usos alcanzado' };
    }

    if (options.userId) {
      const client = options.client ?? this.prisma;
      const alreadyRedeemed = await client.promoCodeRedemption.findFirst({
        where: { promoCodeId: promo.id, userId: options.userId },
        select: { id: true },
      });

      if (alreadyRedeemed) {
        return {
          valid: false,
          message: 'Este código ya fue usado en tu cuenta',
        };
      }
    }

    return { valid: true };
  }

  private pickShippingMethod(
    methods: CheckoutShippingMethod[],
    requested?: ShippingMethodCode,
  ): CheckoutShippingMethod | null {
    if (!methods.length) {
      return null;
    }

    if (requested) {
      const desired = methods.find((method) => method.code === requested);
      if (desired) {
        return desired;
      }
    }

    return methods.reduce((cheapest, current) =>
      current.amountCents < cheapest.amountCents ? current : cheapest,
    );
  }

  private assertCartEligibleForCheckout(cart: CartSnapshot | null): void {
    if (!cart?.items?.length) return;

    for (const item of cart.items) {
      const variant = item.variant;
      const product = variant?.product;
      if (!variant || !product) {
        throw new BadRequestException('INVALID_CART_ITEM_VARIANT');
      }
      if (!variant.isActive || !product.isActive) {
        throw new BadRequestException('INACTIVE_PRODUCT_OR_VARIANT');
      }
      if (!Number.isInteger(item.qty) || item.qty <= 0) {
        throw new BadRequestException('INVALID_CART_ITEM_QUANTITY');
      }
      if (item.qty > variant.stockQty) {
        throw new BadRequestException('INSUFFICIENT_STOCK_AT_CHECKOUT');
      }
      this.getCheckoutUnitPriceCents(item);
    }
  }

  private getCheckoutUnitPriceCents(
    item: CartSnapshot['items'][number],
  ): number {
    const variant = item.variant;
    const product = variant?.product;
    if (!variant || !product) {
      throw new BadRequestException('INVALID_CART_ITEM_VARIANT');
    }

    const price = variant.price ?? product.price;
    if (!Number.isInteger(price) || price < 0) {
      throw new BadRequestException('VARIANT_PRICE_NOT_SET');
    }
    return price;
  }

  private computeItemsTotalCents(cart: CartSnapshot | null): number {
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) {
      return 0;
    }

    return cart.items.reduce(
      (acc, item) => acc + this.getCheckoutUnitPriceCents(item) * item.qty,
      0,
    );
  }

  private computeOrderItemsQuantity(items: OrderWithItems['items']): number {
    if (!Array.isArray(items) || !items.length) return 0;
    return items.reduce((total, item) => total + Math.max(0, item.quantity), 0);
  }

  private buildCheckoutComputation(
    cart: CartSnapshot | null,
    options: {
      shippingCostCents: number;
      itemsTotalCents: number;
      discountCents?: number;
    },
  ): CheckoutComputation {
    const taxRate = this.rateFromNumber(this.taxConfig.getDefaultVat());
    const shippingCost = this.centsToDecimal(options.shippingCostCents);
    const discountCents = Math.max(0, options.discountCents ?? 0);
    const discount = this.centsToDecimal(discountCents);
    const currency =
      cart?.items[0]?.variant?.product?.currency ?? DEFAULT_CURRENCY;

    if (!cart || !cart.items.length) {
      return {
        currency,
        taxRate,
        subtotal: this.moneyFromNumber(0),
        taxAmount: this.moneyFromNumber(0),
        shippingCost,
        shippingCostCents: options.shippingCostCents,
        discount,
        discountCents,
        total: shippingCost,
        lineItems: [],
        itemsTotalCents: 0,
      };
    }

    const lineItems: CheckoutLineItem[] = cart.items.map((item) =>
      this.buildLineItem(item),
    );
    const discountedItemsCents = Math.max(
      0,
      options.itemsTotalCents - discountCents,
    );
    const discountedSubtotal = this.centsToDecimal(discountedItemsCents);
    const subtotal = this.centsToDecimal(options.itemsTotalCents);

    const taxAmount = (() => {
      if (discountedItemsCents <= 0) {
        return this.moneyFromNumber(0);
      }

      const taxBase = this.roundMoney(
        discountedSubtotal.dividedBy(taxRate.add(1)),
      );
      return this.roundMoney(discountedSubtotal.minus(taxBase));
    })();
    const rawTotal = discountedSubtotal.add(shippingCost);
    const total = rawTotal.isNegative()
      ? this.moneyFromNumber(0)
      : this.roundMoney(rawTotal);

    return {
      currency,
      taxRate,
      subtotal,
      taxAmount,
      shippingCost,
      shippingCostCents: options.shippingCostCents,
      discount,
      discountCents,
      total,
      lineItems,
      itemsTotalCents: discountedItemsCents,
    };
  }

  private buildLineItem(item: CartSnapshot['items'][number]): CheckoutLineItem {
    if (!item.variant || !item.variant.product) {
      throw new BadRequestException('INVALID_CART_ITEM_VARIANT');
    }

    const unitPrice = this.centsToDecimal(this.getCheckoutUnitPriceCents(item));
    const lineTotal = this.roundMoney(unitPrice.mul(item.qty));
    const sizeLabel = item.variant.size ? ` (${item.variant.size})` : '';
    const title = `${item.variant.product.name}${sizeLabel}`;

    return {
      productId: item.variant.productId,
      variantId: item.variantId,
      title,
      quantity: item.qty,
      unitPrice,
      lineTotal,
    };
  }

  private resolveOrderBy(
    sort: PaginationDto['sort'],
    order: PaginationDto['order'],
  ): Prisma.OrderOrderByWithRelationInput {
    const direction = order ?? 'desc';

    switch (sort) {
      case 'total':
        return { total: direction };
      case 'status':
        return { status: direction };
      case 'createdAt':
      default:
        return { createdAt: direction };
    }
  }

  private centsToDecimal(cents: number): Prisma.Decimal {
    return this.roundMoney(new Decimal(cents).dividedBy(100));
  }

  private decimalToCents(value: Prisma.Decimal): number {
    return Number(value.mul(100).toFixed(0));
  }

  private toInputJsonValue(
    value: Prisma.JsonValue | Record<string, unknown> | null | undefined,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }
    return value as Prisma.InputJsonValue;
  }

  private normalizeName(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  private extractNames(
    input: unknown,
  ): { firstName?: string; lastName?: string } | null {
    if (!input || typeof input !== 'object') return null;
    const record = input as Record<string, unknown>;
    const primaryFirst =
      this.normalizeName(record.firstName) ||
      this.normalizeName(record.firstname) ||
      this.normalizeName(record.first_name);
    const primaryLast =
      this.normalizeName(record.lastName) ||
      this.normalizeName(record.lastname) ||
      this.normalizeName(record.last_name);

    let firstName = primaryFirst;
    let lastName = primaryLast;

    if (!firstName && !lastName && typeof record.name === 'string') {
      const parts = record.name.trim().split(/\s+/);
      if (parts.length > 0) {
        firstName = parts.shift();
        lastName = parts.join(' ') || undefined;
      }
    }

    if (!firstName && !lastName) {
      return null;
    }

    return {
      firstName: firstName || undefined,
      lastName: lastName || undefined,
    };
  }

  private async fillMissingUserNames(
    tx: Prisma.TransactionClient,
    userId: number,
    primary?: { firstName?: string; lastName?: string } | null,
    fallback?: { firstName?: string; lastName?: string } | null,
  ) {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true },
    });

    if (!user) return;

    const needsFirst = !user.firstName || !user.firstName.trim();
    const needsLast = !user.lastName || !user.lastName.trim();

    if (!needsFirst && !needsLast) {
      return;
    }

    const firstName = primary?.firstName ?? fallback?.firstName;
    const lastName = primary?.lastName ?? fallback?.lastName;

    const data: Prisma.UserUpdateInput = {};

    if (needsFirst && firstName) data.firstName = firstName;
    if (needsLast && lastName) data.lastName = lastName;

    if (Object.keys(data).length === 0) {
      return;
    }

    await tx.user.update({
      where: { id: userId },
      data,
    });
  }

  private moneyFromNumber(amount: number): Prisma.Decimal {
    return new Decimal(amount.toFixed(2));
  }

  private rateFromNumber(rate: number): Prisma.Decimal {
    return new Decimal(rate.toFixed(4));
  }

  private roundMoney(value: Prisma.Decimal): Prisma.Decimal {
    return new Decimal(value.toFixed(2));
  }

  private formatMoney(value: Prisma.Decimal | number, digits = 2): string {
    if (typeof value === 'number') {
      return (value / 100).toFixed(digits);
    }

    return value.toFixed(digits);
  }

  private formatRate(value: Prisma.Decimal): string {
    return value.toFixed(4);
  }

  async markOrderAsRefunded(providerRef: string): Promise<void> {
    await this.applyStripePaymentLifecycle(providerRef, OrderStatus.REFUNDED);
  }
  private async handlePromoUsageOnPaid(
    tx: Prisma.TransactionClient,
    order: OrderWithItems,
    previousStatus?: OrderStatus | null,
  ) {
    if (
      !order ||
      order.status !== OrderStatus.PAID ||
      previousStatus === OrderStatus.PAID
    ) {
      return;
    }

    if (!order.promoCodeId) {
      return;
    }

    const promo = await tx.promoCode.findUnique({
      where: { id: order.promoCodeId },
      select: {
        id: true,
        code: true,
        startsAt: true,
        expiresAt: true,
        isActive: true,
        usageLimit: true,
        usageCount: true,
      },
    });

    if (!promo) {
      return;
    }

    const validation = await this.validatePromoAvailability(promo, {
      userId: order.userId,
      client: tx,
    });

    if (!validation.valid) {
      throw new BadRequestException(
        validation.message ?? 'PROMO_NOT_AVAILABLE',
      );
    }

    const usageLimitCondition =
      promo.usageLimit != null ? { usageCount: { lt: promo.usageLimit } } : {};

    const incremented = await tx.promoCode.updateMany({
      where: { id: promo.id, ...usageLimitCondition },
      data: { usageCount: { increment: 1 } },
    });

    if (incremented.count === 0) {
      throw new BadRequestException('Límite de usos alcanzado');
    }

    try {
      await tx.promoCodeRedemption.create({
        data: {
          promoCodeId: promo.id,
          userId: order.userId,
          orderId: order.id,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new BadRequestException('Este código ya fue usado en tu cuenta');
      }
      throw error;
    }

    if (!order.promoCodeCode) {
      await tx.order.update({
        where: { id: order.id },
        data: { promoCodeCode: promo.code },
      });
    }
  }

  private serializeOrder(order: OrderWithItems): Record<string, unknown> {
    return {
      id: order.id,
      userId: order.userId,
      status: order.status,
      subtotal: this.formatMoney(order.subtotal),
      taxRate: this.formatRate(order.taxRate),
      taxAmount: this.formatMoney(order.taxAmount),
      shippingCost: this.formatMoney(order.shippingCost),
      discount: this.formatMoney(this.centsToDecimal(order.discountCents)),
      disputeLostCents: order.disputeLostCents,
      total: this.formatMoney(order.total),
      currency: order.currency,
      provider: order.provider,
      providerRef: order.providerRef,
      promoCode: order.promoCodeCode,
      shippingMethodId: order.shippingMethodId,
      shippingMethodCode: order.shippingMethodCode,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      shippingAddr: order.shippingAddr,
      billingAddr: order.billingAddr,
      items: order.items.map((item) => ({
        id: item.id,
        orderId: item.orderId,
        productId: item.productId,
        title: item.title,
        unitPrice: this.formatMoney(item.unitPrice),
        quantity: item.quantity,
        lineTotal: this.formatMoney(item.lineTotal),
      })),
    };
  }
}
