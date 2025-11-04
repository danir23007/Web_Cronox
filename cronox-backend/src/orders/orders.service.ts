// [ORDERS] Lógica de negocio para checkout y pedidos
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, Role } from '@prisma/client';
import { CartService } from '../cart/cart.service';
import { TaxConfigService } from '../common/tax/tax-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import { PaginationDto } from './dto/pagination.dto';

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

type AuthenticatedUser = {
  id: number;
  role: Role;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly taxConfig: TaxConfigService,
  ) {}

  async createCheckoutSession(
    userId: number,
    dto: CreateCheckoutSessionDto,
  ): Promise<Record<string, unknown>> {
    const cart = (await this.cartService.getOrCreateCart({ userId })) as CartSnapshot;

    if (!cart.items.length) {
      throw new BadRequestException('CART_EMPTY');
    }

    const computation = this.buildCheckoutComputation(cart);
    const provider = this.taxConfig.getPaymentProvider();

    const lineItems = computation.lineItems.map((item) => ({
      productId: item.productId,
      title: item.title,
      quantity: item.quantity,
      unitPrice: this.formatMoney(item.unitPrice),
      lineTotal: this.formatMoney(item.lineTotal),
    }));

    const summary = {
      currency: computation.currency,
      subtotal: this.formatMoney(computation.subtotal),
      taxRate: this.formatRate(computation.taxRate),
      taxAmount: this.formatMoney(computation.taxAmount),
      shippingCost: this.formatMoney(computation.shippingCost),
      total: this.formatMoney(computation.total),
    };

    const metadata: Record<string, unknown> = {
      cartId: cart.id,
      userId,
    };

    if (dto.shippingMethod) {
      metadata.shippingMethod = dto.shippingMethod;
    }
    if (dto.couponCode) {
      metadata.couponCode = dto.couponCode;
    }

    const response: Record<string, unknown> = {
      provider,
      summary,
      lineItems,
      metadata,
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

  async createOrderFromWebhook(dto: CreateOrderWebhookDto): Promise<Record<string, unknown>> {
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
      const computation = this.buildCheckoutComputation(cart);
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

  private buildCheckoutComputation(cart: CartSnapshot | null): CheckoutComputation {
    const taxRate = this.rateFromNumber(this.taxConfig.getDefaultVat());
    const shippingCost = this.moneyFromNumber(this.taxConfig.getFlatShipping());
    const currency = cart?.items[0]?.variant?.product?.currency ?? DEFAULT_CURRENCY;

    if (!cart) {
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
    return this.roundMoney(new Prisma.Decimal(cents).dividedBy(100));
  }

  private moneyFromNumber(amount: number): Prisma.Decimal {
    return new Prisma.Decimal(amount.toFixed(2));
  }

  private moneyFromString(amount: string): Prisma.Decimal {
    return new Prisma.Decimal(amount);
  }

  private rateFromNumber(rate: number): Prisma.Decimal {
    return new Prisma.Decimal(rate.toFixed(4));
  }

  private roundMoney(value: Prisma.Decimal): Prisma.Decimal {
    return new Prisma.Decimal(value.toFixed(2));
  }

  private formatMoney(value: Prisma.Decimal, digits = 2): string {
    return value.toFixed(digits);
  }

  private formatRate(value: Prisma.Decimal): string {
    return value.toFixed(4);
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
