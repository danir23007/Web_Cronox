// [ORDERS] Pruebas unitarias del servicio de pedidos
import type { Role } from '@prisma/client';

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
    CANCELLED: 'CANCELLED',
    REFUNDED: 'REFUNDED',
    SHIPPED: 'SHIPPED',
  },
  Role: {
    ADMIN: 'ADMIN',
    USER: 'USER',
  },
}));
import { Decimal } from '@prisma/client/runtime/library';
import { OrdersService } from './orders.service';
import { TaxConfigService } from '../common/tax/tax-config.service';
import { CartService } from '../cart/cart.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderWebhookDto } from './dto/create-order-webhook.dto';
import type { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: {
    order: {
      findUnique: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    orderItem: { createMany: jest.Mock };
    cart: { findUnique: jest.Mock; update: jest.Mock };
    cartItem: { deleteMany: jest.Mock };
    productVariant: { updateMany: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    stockMovement: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let cartService: { getOrCreateCart: jest.Mock };
  let taxConfig: { getDefaultVat: jest.Mock; getPaymentProvider: jest.Mock };
  let shippingMethods: {
    getMethod: jest.Mock<
      Promise<{
        id: number;
        code: ShippingMethodCode;
        label: string;
        amountCents: number;
      }>,
      [ShippingMethodCode, number]
    >;
    listAvailableMethods: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      order: {
        findUnique: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      orderItem: { createMany: jest.fn() },
      cart: { findUnique: jest.fn(), update: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
      productVariant: {
        updateMany: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      stockMovement: { create: jest.fn() },
      $transaction: jest.fn(),
    };

    cartService = {
      getOrCreateCart: jest.fn(),
    };

    taxConfig = {
      getDefaultVat: jest.fn().mockReturnValue(0.21),
      getPaymentProvider: jest.fn().mockReturnValue('none'),
    };

    shippingMethods = {
      getMethod: jest.fn(async (code: ShippingMethodCode, itemsTotal: number) => {
        const basePrice = code === 'EXPRESS' ? 495 : 295;
        const amountCents =
          code === 'STANDARD' && itemsTotal >= 6500 ? 0 : basePrice;

        return {
          id: code === 'EXPRESS' ? 2 : 1,
          code,
          label: code === 'EXPRESS' ? 'Envío express' : 'Envío estándar',
          amountCents,
        };
      }),
      listAvailableMethods: jest.fn(),
    };

    prisma.$transaction.mockImplementation(async (cb: (tx: any) => Promise<unknown>) =>
      cb({
        ...prisma,
        order: prisma.order,
        orderItem: prisma.orderItem,
        cart: prisma.cart,
        cartItem: prisma.cartItem,
        productVariant: prisma.productVariant,
        stockMovement: prisma.stockMovement,
      }),
    );

    service = new OrdersService(
      prisma as unknown as PrismaService,
      cartService as unknown as CartService,
      taxConfig as unknown as TaxConfigService,
      shippingMethods as any,
    );
  });

  it('calcula totales e IVA correctamente durante el checkout', async () => {
    const cartSnapshot = {
      id: 10,
      userId: 1,
      items: [
        {
          priceAtAdd: 10000,
          qty: 2,
          variant: {
            productId: 7,
            size: 'M',
            product: { name: 'Camiseta', currency: 'EUR' },
          },
        },
      ],
    } as any;

    cartService.getOrCreateCart.mockResolvedValue(cartSnapshot);

    const result = await service.createCheckoutSession(1, { shippingMethod: 'EXPRESS' } as any);

    expect(result.summary).toMatchObject({
      subtotal: '200.00',
      taxRate: '0.2100',
      taxAmount: '42.00',
      shippingCost: '4.95',
      total: '246.95',
    });
    expect(result.lineItems).toHaveLength(1);
    expect(result.lineItems[0]).toMatchObject({ lineTotal: '200.00', quantity: 2 });
    expect(result.metadata).toMatchObject({
      shippingMethod: 'EXPRESS',
      shippingCostCents: 495,
      itemsTotalCents: 20000,
    });
    expect(result.shippingMethod).toMatchObject({
      code: 'EXPRESS',
      amount: '4.95',
      amountCents: 495,
    });
  });

  it('mantiene idempotencia por providerRef al crear pedidos desde webhook', async () => {
    const cartSnapshot = {
      id: 10,
      userId: 3,
      items: [
        {
          priceAtAdd: 10000,
          qty: 1,
          variant: {
            productId: 2,
            size: 'M',
            product: { name: 'Camiseta', currency: 'EUR' },
          },
        },
      ],
    } as any;

    prisma.cart.findUnique.mockResolvedValue(cartSnapshot);

    const createdOrder = {
      id: 99,
      userId: 3,
      status: 'PAID',
      subtotal: new Decimal('100.00'),
      taxRate: new Decimal('0.2100'),
      taxAmount: new Decimal('21.00'),
      shippingCost: 0,
      shippingMethodId: null,
      shippingMethodCode: 'STANDARD',
      total: new Decimal('121.00'),
      currency: 'EUR',
      provider: 'stripe',
      providerRef: 'pi_123',
      createdAt: new Date(),
      updatedAt: new Date(),
      shippingAddr: null,
      billingAddr: null,
      items: [
        {
          id: 1,
          orderId: 99,
          productId: 2,
          title: 'Camiseta (M)',
          unitPrice: new Decimal('100.00'),
          quantity: 1,
          lineTotal: new Decimal('100.00'),
        },
      ],
    };

    prisma.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdOrder)
      .mockResolvedValue(createdOrder);

    prisma.order.create.mockResolvedValue({ id: 99 });

    const dto: CreateOrderWebhookDto = {
      provider: 'stripe',
      providerRef: 'pi_123',
      amount: '121.00',
      currency: 'EUR',
      metadata: {
        userId: 3,
        cartId: 10,
        shippingMethod: 'STANDARD',
        shippingCostCents: '0',
        itemsTotalCents: '10000',
      } as any,
    } as CreateOrderWebhookDto;

    const first = await service.createOrderFromWebhook(dto);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ id: 99, total: '121.00', status: 'PAID' });

    const second = await service.createOrderFromWebhook(dto);
    expect(prisma.order.create).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('descuenta stock y registra movimientos cuando el pago se confirma', async () => {
    const cartSnapshot = {
      id: 20,
      userId: 4,
      items: [
        {
          id: 1,
          variantId: 8,
          priceAtAdd: 10000,
          qty: 2,
          variant: {
            productId: 2,
            sku: 'SKU-123',
            stockQty: 5,
            product: { name: 'Camiseta', currency: 'EUR' },
          },
        },
      ],
    } as any;

    prisma.cart.findUnique.mockResolvedValue(cartSnapshot);

    const createdOrder = {
      id: 77,
      userId: 4,
      status: 'PAID',
      subtotal: new Decimal('200.00'),
      taxRate: new Decimal('0.2100'),
      taxAmount: new Decimal('42.00'),
      shippingCost: 0,
      shippingMethodId: null,
      shippingMethodCode: 'STANDARD',
      total: new Decimal('242.00'),
      currency: 'EUR',
      provider: 'stripe',
      providerRef: 'pi_stock',
      createdAt: new Date(),
      updatedAt: new Date(),
      shippingAddr: null,
      billingAddr: null,
      items: [
        {
          id: 1,
          orderId: 77,
          productId: 2,
          title: 'Camiseta (M)',
          unitPrice: new Decimal('100.00'),
          quantity: 2,
          lineTotal: new Decimal('200.00'),
        },
      ],
    };

    prisma.order.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdOrder)
      .mockResolvedValue(createdOrder);

    prisma.order.create.mockResolvedValue({ id: createdOrder.id });
    prisma.productVariant.updateMany.mockResolvedValue({ count: 1 });
    prisma.stockMovement.create.mockResolvedValue({});

    const dto: CreateOrderWebhookDto = {
      provider: 'stripe',
      providerRef: 'pi_stock',
      amount: '242.00',
      currency: 'EUR',
      metadata: {
        userId: 4,
        cartId: 20,
        shippingMethod: 'STANDARD',
        shippingCostCents: '0',
        itemsTotalCents: '20000',
      } as any,
    } as CreateOrderWebhookDto;

    const result = await service.createOrderFromWebhook(dto, { updateStock: true });

    expect(prisma.productVariant.updateMany).toHaveBeenCalledWith({
      where: { id: 8, stockQty: { gte: 2 } },
      data: { stockQty: { decrement: 2 } },
    });
    expect(prisma.stockMovement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        variantId: 8,
        delta: -2,
        orderId: createdOrder.id,
        reason: 'order',
      }),
    });
    expect(result).toMatchObject({ status: 'PAID' });
  });

  it('filtra pedidos por usuario autenticado', async () => {
    const orderEntity = {
      id: 1,
      userId: 4,
      status: 'PAID',
      subtotal: new Decimal('100.00'),
      taxRate: new Decimal('0.2100'),
      taxAmount: new Decimal('21.00'),
      shippingCost: 0,
      shippingMethodId: null,
      shippingMethodCode: 'STANDARD',
      total: new Decimal('121.00'),
      currency: 'EUR',
      provider: 'stripe',
      providerRef: 'pi_789',
      createdAt: new Date(),
      updatedAt: new Date(),
      shippingAddr: null,
      billingAddr: null,
      items: [
        {
          id: 1,
          orderId: 1,
          productId: 5,
          title: 'Producto',
          unitPrice: new Decimal('100.00'),
          quantity: 1,
          lineTotal: new Decimal('100.00'),
        },
      ],
    };

    prisma.order.findMany.mockResolvedValue([orderEntity]);
    prisma.order.count.mockResolvedValue(1);

    const result = await service.listOrders({ id: 4, role: 'USER' as Role }, {} as any);

    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 4 } }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({ id: 1, subtotal: '100.00' });
  });
});
