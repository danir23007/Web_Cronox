// [ORDERS] Lógica de negocio para checkout y pedidos
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import { PaginationDto } from './dto/pagination.dto';
import {
  FREE_SHIPPING_THRESHOLD_CENTS,
  ShippingMethodOption,
  ShippingMethodsService,
} from '../shipping-methods/shipping-methods.service';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';

const DEFAULT_CURRENCY = 'EUR';

type CartSnapshot = CartWithItems;

type OrderWithItems = Prisma.OrderGetPayload<{
  include: { items: true };
}>;

type CheckoutLineItem = {
  productId: number;
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
  role: Role;
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

    const itemsTotalCents = hasItems ? this.computeItemsTotalCents(cart) : 0;
    let methods = await this.shippingMethods.listAvailableMethods(
      itemsTotalCents,
    );

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

    if (!cart.items.length) {
      throw new BadRequestException({
        code: 'EMPTY_CART',
        message: 'No puedes iniciar el checkout sin productos en el carrito.',
      });
    }

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

  async createOrderFromWebhook(
    dto: CreateOrderWebhookDto,
    options: { updateStock?: boolean; allowNegativeStock?: boolean } = {},
  ): Promise<Record<string, unknown>> {
    const providerRef = dto.providerRef;

    return this.prisma.$transaction(async (tx) => {
      const existing: OrderWithItems | null = await tx.order.findUnique({
        where: { providerRef },
        include: { items: true },
      });
      const existingStatus = existing?.status;

      if (existing) {
        return this.serializeOrder(existing);
      }

      const userId = dto.metadata.userId;

      if (!userId) {
        throw new BadRequestException('USER_ID_REQUIRED');
      }

      const cart = await this.loadCartSnapshot(tx, dto.metadata.cartId, userId);

if (!cart) {
  throw new BadRequestException('CART_NOT_FOUND');
}

      const shippingMethod = dto.metadata.shippingMethod;
      if (!shippingMethod) {
        throw new BadRequestException('SHIPPING_METHOD_REQUIRED');
      }

      const shippingCostCents = Number(dto.metadata.shippingCostCents);
      if (!Number.isFinite(shippingCostCents)) {
        throw new BadRequestException('SHIPPING_COST_METADATA_REQUIRED');
      }
      const metadataItemsTotal = Number(dto.metadata.itemsTotalCents);
      if (!Number.isFinite(metadataItemsTotal)) {
        throw new BadRequestException('ITEMS_TOTAL_METADATA_REQUIRED');
      }
      const promoCode = this.normalizePromoCode(dto.metadata.promoCode);
      const discountFromMetadata = Math.max(
        0,
        Number(dto.metadata.discountCents ?? 0) || 0,
      );
      const itemsTotalCents = this.computeItemsTotalCents(cart);
      const methodBeforeDiscount = await this.shippingMethods.getMethod(
        shippingMethod,
        itemsTotalCents,
      );
      const baseTotals = this.calculateCartTotals(
        cart,
        methodBeforeDiscount,
        0,
      );
      const appliedPromo = promoCode
        ? await this.computePromoApplication(
            cart,
            methodBeforeDiscount,
            promoCode,
            baseTotals,
            { userId, client: tx },
          )
        : null;
      const discountCents = appliedPromo?.valid
        ? appliedPromo.discountCents
        : Math.min(discountFromMetadata, baseTotals.totalCents);
      const validatedMethod = await this.shippingMethods.getMethod(
        shippingMethod,
        itemsTotalCents,
        discountCents,
      );
      const totalsForOrder = this.calculateCartTotals(
        cart,
        validatedMethod,
        discountCents,
      );
      const expectedShippingCents = totalsForOrder.shippingCents;

      if (expectedShippingCents !== shippingCostCents) {
        this.logger.warn(
          `Shipping cost mismatch for ${providerRef}: metadata=${shippingCostCents} expected=${expectedShippingCents}`,
        );
      }

      const computation = this.buildCheckoutComputation(cart, {
        shippingCostCents: totalsForOrder.shippingCents,
        itemsTotalCents,
        discountCents: totalsForOrder.discountCents,
      });
      const providerAmount = this.moneyFromString(dto.amount);
      const totalsMatch = providerAmount.equals(computation.total);

      if (!totalsMatch) {
        this.logger.warn(
          `Diferencia entre el total esperado (${this.formatMoney(
            computation.total,
          )}) y el cobrado (${providerAmount.toFixed(2)}) para ${providerRef}`,
        );
      }

      const status = totalsMatch ? OrderStatus.PAID : OrderStatus.PENDING;

      // [FIX] JsonNull es un valor, no un tipo → usamos typeof Prisma.JsonNull
      const shippingAddr: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        dto.shippingAddress
          ? (dto.shippingAddress as Prisma.InputJsonValue)
          : dto.metadata?.shippingAddress
            ? (dto.metadata.shippingAddress as Prisma.InputJsonValue)
            : Prisma.JsonNull;

      // [FIX] Igual para billing
      const billingAddr: Prisma.InputJsonValue | typeof Prisma.JsonNull =
        dto.billingAddress
          ? (dto.billingAddress as Prisma.InputJsonValue)
          : dto.metadata?.billingAddress
            ? (dto.metadata.billingAddress as Prisma.InputJsonValue)
            : Prisma.JsonNull;

      const shippingName = this.extractNames(
        dto.shippingAddress ?? dto.metadata?.shippingAddress,
      );
      const billingName = this.extractNames(
        dto.billingAddress ?? dto.metadata?.billingAddress,
      );

      let promoId: number | null = appliedPromo?.promoId ?? null;
      if (!promoId && promoCode) {
        const promo = await tx.promoCode.findFirst({
          where: { code: promoCode },
        });
        promoId = promo?.id ?? null;
      }

      const order = await tx.order.create({
        data: {
          userId,
          status,
          subtotal: computation.subtotal,
          taxRate: computation.taxRate,
          taxAmount: computation.taxAmount,
          shippingCost: totalsForOrder.shippingCents,
          shippingMethodId: validatedMethod.id ?? null,
          shippingMethodCode: validatedMethod.code,
          discountCents: totalsForOrder.discountCents,
          promoCodeId: promoId,
          promoCodeCode: promoCode ?? null,
          total: computation.total,
          currency: dto.currency ?? computation.currency,
          provider: dto.provider,
          providerRef,
          shippingAddr: shippingAddr, // [FIX]
          billingAddr: billingAddr, // [FIX]
        },
      });

      if (computation.lineItems.length > 0) {
        await tx.orderItem.createMany({
          data: computation.lineItems.map((item) => ({
            orderId: order.id,
            productId: item.productId,
            title: item.title,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            lineTotal: item.lineTotal,
          })),
        });
      }

      if (status === OrderStatus.PAID && cart && options.updateStock) {
        await this.adjustStockForPaidOrder(
          tx,
          order.id,
          cart,
          options.allowNegativeStock,
        ); // [STOCK]
      }

      if (status === OrderStatus.PAID && cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { itemsCount: 0, subtotal: 0 },
        });
      }

      await this.fillMissingUserNames(tx, userId, shippingName, billingName);

      const created = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: true },
      });

      if (!created) {
        throw new NotFoundException('ORDER_NOT_FOUND_AFTER_CREATE');
      }

      if (status === OrderStatus.PAID) {
        const quantity = this.computeOrderItemsQuantity(created.items);
        await this.historialService.incrementOrderProgress(
          userId,
          quantity,
          tx,
        );
      }

      await this.handlePromoUsageOnPaid(tx, created, existingStatus);

      return this.serializeOrder(created);
    });
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

    const where = user.role === Role.ADMIN ? {} : { userId: user.id };

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
    if (user.role !== Role.ADMIN && !isOwner) {
      throw new ForbiddenException('ACCESS_DENIED');
    }

    return this.serializeOrder(order);
  }

  private async loadCartSnapshot(
    tx: Prisma.TransactionClient,
    cartId: number | undefined,
    userId: number,
  ): Promise<CartSnapshot | null> {
    if (cartId) {
      const cart = await tx.cart.findUnique({
        where: { id: cartId },
        include: cartInclude,
      });

      if (cart && cart.userId && cart.userId !== userId) {
        this.logger.warn(`Cart ${cartId} no pertenece al usuario ${userId}`);
        return null;
      }

      if (cart) {
        return cart;
      }
    }

    const fallback = await tx.cart.findUnique({
      where: { userId },
      include: cartInclude,
    });

    return fallback ?? null;
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

  private computeItemsTotalCents(cart: CartSnapshot | null): number {
    if (!cart || !Array.isArray(cart.items) || !cart.items.length) {
      return 0;
    }

    return cart.items.reduce(
      (acc, item) => acc + item.priceAtAdd * item.qty,
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

    const unitPrice = this.centsToDecimal(item.priceAtAdd);
    const lineTotal = this.roundMoney(unitPrice.mul(item.qty));
    const sizeLabel = item.variant.size ? ` (${item.variant.size})` : '';
    const title = `${item.variant.product.name}${sizeLabel}`;

    return {
      productId: item.variant.productId,
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

  private moneyFromString(amount: string): Prisma.Decimal {
    return new Decimal(amount);
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

  private async adjustStockForPaidOrder(
    tx: Prisma.TransactionClient,
    orderId: number,
    cart: CartSnapshot,
    allowNegativeStockOverride?: boolean,
  ): Promise<void> {
    // [STOCK]
    const allowNegative =
      allowNegativeStockOverride !== undefined
        ? allowNegativeStockOverride
        : this.allowNegativeStock;

    for (const item of cart.items) {
      if (item.qty <= 0) {
        continue;
      }

      const variantId = item.variantId;
      const variantSku = item.variant?.sku ?? 'UNKNOWN';

      let currentStock: number | null = null;
      if (item.variant && typeof (item.variant as any).stockQty === 'number') {
        currentStock = (item.variant as any).stockQty as number;
      } else if (
        item.variant &&
        typeof (item.variant as any).stock === 'number'
      ) {
        currentStock = (item.variant as any).stock as number;
      }

      if (currentStock === null) {
        const dbVariant = await tx.productVariant.findUnique({
          where: { id: variantId },
          select: { stockQty: true },
        });
        currentStock = dbVariant?.stockQty ?? 0;
      }

      if (!allowNegative && currentStock < item.qty) {
        this.logger.warn(
          `No hay stock suficiente para la variante ${variantSku} (${variantId}) en el pedido ${orderId}`,
        );
        throw new BadRequestException('INSUFFICIENT_STOCK_AT_CHECKOUT');
      }

      if (allowNegative && currentStock < item.qty) {
        this.logger.warn(
          `El pedido ${orderId} provocará stock negativo en la variante ${variantSku} (${variantId})`,
        );
      }

      if (allowNegative) {
        await tx.productVariant.update({
          where: { id: variantId },
          data: { stockQty: { decrement: item.qty } },
        });
      } else {
        const result = await tx.productVariant.updateMany({
          where: { id: variantId, stockQty: { gte: item.qty } },
          data: { stockQty: { decrement: item.qty } },
        });

        if (result.count === 0) {
          this.logger.error(
            `No se pudo descontar stock para la variante ${variantSku} (${variantId}) en el pedido ${orderId}`,
          );
          throw new BadRequestException('INSUFFICIENT_STOCK_AT_CHECKOUT');
        }
      }

      await tx.stockMovement.create({
        data: {
          variantId,
          delta: -item.qty,
          reason: 'order',
          orderId,
        },
      });
    }
  }

  async markOrderAsRefunded(providerRef: string): Promise<void> {
    // [STRIPE]
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { providerRef },
        include: { items: true },
      });

      if (!order) {
        this.logger.warn(
          `No se encontró ningún pedido para marcar como REFUNDED con providerRef ${providerRef}`,
        );
        return;
      }

      if (order.status !== OrderStatus.REFUNDED) {
        await tx.order.update({
          where: { providerRef },
          data: { status: OrderStatus.REFUNDED },
        });

        const itemsCount = this.computeOrderItemsQuantity(order.items);
        await this.historialService.registerReturn(
          order.userId,
          itemsCount,
          tx,
        );
      }
    });
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
