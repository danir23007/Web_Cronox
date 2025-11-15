// [ORDERS] Lógica de negocio para checkout y pedidos
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { CartService } from '../cart/cart.service';
import { TaxConfigService } from '../common/tax/tax-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import { PaginationDto } from './dto/pagination.dto';
import {
  ShippingMethodResponse,
  ShippingMethodsService,
} from '../shipping-methods/shipping-methods.service';

const DEFAULT_CURRENCY = 'EUR';

type CartSnapshot = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        variant: {
          include: {
            product: true;
          };
        };
      };
    };
  };
}>;

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
  total: Prisma.Decimal;
  lineItems: CheckoutLineItem[];
};

type CheckoutSummaryResponse = { // [STRIPE]
  currency: string;
  subtotal: string;
  taxRate: string;
  taxAmount: string;
  shippingCost: string;
  total: string;
};

type CheckoutLineItemResponse = { // [STRIPE]
  productId: number;
  title: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

type CheckoutMetadata = {
  cartId: number;
  userId: number;
  shippingMethodId: number;
  shippingCostCents: number;
};

type CheckoutPreview = { // [STRIPE]
  cart: CartSnapshot;
  computation: CheckoutComputation;
  summary: CheckoutSummaryResponse;
  lineItems: CheckoutLineItemResponse[];
  metadata: CheckoutMetadata;
  shippingMethod: ShippingMethodResponse;
};

type AuthenticatedUser = {
  id: number;
  role: Role;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);
  private readonly allowNegativeStock = process.env.ALLOW_NEGATIVE_STOCK === 'true'; // [STOCK]

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly taxConfig: TaxConfigService,
    private readonly shippingMethods: ShippingMethodsService,
  ) {}

  async getCheckoutPreview(
    userId: number,
    params: { shippingMethodId: number; shippingCountry?: string },
  ): Promise<CheckoutPreview> { // [STRIPE]
    const cart = (await this.cartService.getOrCreateCart({ userId })) as CartSnapshot;

    if (!cart.items.length) {
      throw new BadRequestException('CART_EMPTY');
    }

    const shippingMethod = await this.shippingMethods.getActiveMethodById(
      params.shippingMethodId,
      params.shippingCountry,
    );
    const shippingCost = this.centsToDecimal(shippingMethod.price);
    const computation = this.buildCheckoutComputation(cart, { shippingCost });
    const summary = this.buildCheckoutSummary(computation);
    const lineItems = this.buildPublicLineItems(computation.lineItems);
    const metadata: CheckoutMetadata = {
      cartId: cart.id,
      userId,
      shippingMethodId: shippingMethod.id,
      shippingCostCents: this.decimalToCents(computation.shippingCost),
    };

    return {
      cart,
      computation,
      summary,
      lineItems,
      metadata,
      shippingMethod: this.shippingMethods.toResponse(shippingMethod),
    };
  }

  async createCheckoutSession(
    userId: number,
    dto: CreateCheckoutSessionDto,
  ): Promise<Record<string, unknown>> {
    const shippingCountry = this.extractCountry(dto.shippingAddress);
    const preview = await this.getCheckoutPreview(userId, {
      shippingMethodId: dto.shippingMethodId,
      shippingCountry,
    }); // [STRIPE]
    const provider = this.taxConfig.getPaymentProvider();

    const metadata: Record<string, unknown> = { ...preview.metadata };
    if (dto.couponCode) {
      metadata.couponCode = dto.couponCode;
    }

    const response: Record<string, unknown> = {
      provider,
      summary: preview.summary,
      lineItems: preview.lineItems,
      metadata,
      shippingMethod: preview.shippingMethod,
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
      const existing = await tx.order.findUnique({
        where: { providerRef },
        include: { items: true },
      });

      if (existing) {
        return this.serializeOrder(existing);
      }

      const userId = dto.metadata.userId;

      if (!userId) {
        throw new BadRequestException('USER_ID_REQUIRED');
      }

      const cart = await this.loadCartSnapshot(tx, dto.metadata.cartId, userId);
      const shippingMethodId = dto.metadata.shippingMethodId;
      if (!shippingMethodId) {
        throw new BadRequestException('SHIPPING_METHOD_REQUIRED');
      }

      const shippingMethod = await this.shippingMethods.getMethodByIdOrThrow(shippingMethodId);
      const shippingCostCents = Number(dto.metadata.shippingCostCents);
      if (!Number.isFinite(shippingCostCents)) {
        throw new BadRequestException('SHIPPING_COST_METADATA_REQUIRED');
      }
      const shippingCost = this.centsToDecimal(shippingCostCents);

      const computation = this.buildCheckoutComputation(cart, { shippingCost });
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

      const order = await tx.order.create({
        data: {
          userId: String(userId), // [FIX] userId es String en Order
          status,
          subtotal: computation.subtotal,
          taxRate: computation.taxRate,
          taxAmount: computation.taxAmount,
          shippingCost: computation.shippingCost,
          total: computation.total,
          currency: dto.currency ?? computation.currency,
          provider: dto.provider,
          providerRef,
          shippingMethodId: shippingMethod.id,
          shippingAddr: shippingAddr, // [FIX]
          billingAddr: billingAddr,   // [FIX]
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

      const created = await tx.order.findUnique({
        where: { id: order.id },
        include: { items: true },
      });

      if (!created) {
        throw new NotFoundException('ORDER_NOT_FOUND_AFTER_CREATE');
      }

      return this.serializeOrder(created);
    });
  }

  async listOrders(
    user: AuthenticatedUser,
    pagination: PaginationDto,
  ): Promise<{ data: Record<string, unknown>[]; meta: Record<string, number> }> {
    const page = pagination.page ?? 1;
    const requestedPageSize = pagination.pageSize ?? 20;
    const pageSize = Math.min(requestedPageSize, 100);
    const skip = (page - 1) * pageSize;

    const orderBy = this.resolveOrderBy(pagination.sort, pagination.order);

    const where = user.role === Role.ADMIN ? {} : { userId: String(user.id) }; // [FIX]

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

    const isOwner = String(order.userId) === String(user.id); // [FIX]
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
        include: {
          items: {
            include: {
              variant: {
                include: { product: true },
              },
            },
          },
        },
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
      include: {
        items: {
          include: {
            variant: {
              include: { product: true },
            },
          },
        },
      },
    });

    return fallback ?? null;
  }

  private buildCheckoutSummary(
    computation: CheckoutComputation,
  ): CheckoutSummaryResponse { // [STRIPE]
    return {
      currency: computation.currency,
      subtotal: this.formatMoney(computation.subtotal),
      taxRate: this.formatRate(computation.taxRate),
      taxAmount: this.formatMoney(computation.taxAmount),
      shippingCost: this.formatMoney(computation.shippingCost),
      total: this.formatMoney(computation.total),
    };
  }

  private buildPublicLineItems(
    lineItems: CheckoutLineItem[],
  ): CheckoutLineItemResponse[] { // [STRIPE]
    return lineItems.map((item) => ({
      productId: item.productId,
      title: item.title,
      quantity: item.quantity,
      unitPrice: this.formatMoney(item.unitPrice),
      lineTotal: this.formatMoney(item.lineTotal),
    }));
  }

  private extractCountry(address?: Record<string, unknown>): string | undefined {
    if (!address) {
      return undefined;
    }

    const typed = address as { country?: unknown; countryCode?: unknown };
    const raw = typed.country ?? typed.countryCode;
    if (typeof raw !== 'string') {
      return undefined;
    }

    const normalized = raw.trim().toUpperCase();
    return normalized || undefined;
  }

  private buildCheckoutComputation(
    cart: CartSnapshot | null,
    options: { shippingCost: Prisma.Decimal },
  ): CheckoutComputation {
    const taxRate = this.rateFromNumber(this.taxConfig.getDefaultVat());
    const shippingCost = options.shippingCost;
    const currency = cart?.items[0]?.variant?.product?.currency ?? DEFAULT_CURRENCY;

    if (!cart || !cart.items.length) {
      return {
        currency,
        taxRate,
        subtotal: this.moneyFromNumber(0),
        taxAmount: this.moneyFromNumber(0),
        shippingCost,
        total: shippingCost,
        lineItems: [],
      };
    }

    const lineItems: CheckoutLineItem[] = cart.items.map((item) => this.buildLineItem(item));

    const subtotal = lineItems.reduce(
      (acc, item) => acc.add(item.lineTotal),
      this.moneyFromNumber(0),
    );

    const taxAmount = this.roundMoney(subtotal.mul(taxRate));
    const total = subtotal.add(taxAmount).add(shippingCost);

    return {
      currency,
      taxRate,
      subtotal,
      taxAmount,
      shippingCost,
      total,
      lineItems,
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

  private formatMoney(value: Prisma.Decimal, digits = 2): string {
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
  ): Promise<void> { // [STOCK]
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
      } else if (item.variant && typeof (item.variant as any).stock === 'number') {
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

  async markOrderAsRefunded(providerRef: string): Promise<void> { // [STRIPE]
    try {
      await this.prisma.order.update({
        where: { providerRef },
        data: { status: OrderStatus.REFUNDED },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        this.logger.warn(
          `No se encontró ningún pedido para marcar como REFUNDED con providerRef ${providerRef}`,
        );
        return;
      }

      throw error;
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
      total: this.formatMoney(order.total),
      currency: order.currency,
      provider: order.provider,
      providerRef: order.providerRef,
      shippingMethodId: order.shippingMethodId,
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
