import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

export const cartInclude = {
  items: {
    orderBy: {
      id: 'asc',
    },
    include: {
      variant: {
        include: {
          product: {
            include: {
              images: {
                orderBy: [
                  { isPrimary: 'desc' },
                  { sortOrder: 'asc' },
                  { id: 'asc' },
                ],
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

type ModelClient = Pick<
  PrismaClient,
  'cart' | 'cartItem' | 'productVariant' | '$transaction'
>;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

export type CartContext = {
  userId?: number;
  anonymousId?: string;
};

export type CartMergeIncident = {
  variantId: number;
  requestedQty: number;
  mergedQty: number;
  availableStock: number;
  reason: 'INSUFFICIENT_STOCK';
};

export type MergeOnLoginResult = {
  merged: boolean;
  incidents: CartMergeIncident[];
};

const NO_CONTEXT_ERROR = 'NO_CONTEXT';
const CART_NOT_FOUND_ERROR = 'CART_NOT_FOUND';
const ITEM_NOT_FOUND_ERROR = 'ITEM_NOT_FOUND';
const INSUFFICIENT_STOCK_ERROR = 'INSUFFICIENT_STOCK';
const VARIANT_PRICE_NOT_SET_ERROR = 'VARIANT_PRICE_NOT_SET';

@Injectable()
export class CartService {
  private readonly logger = new Logger(CartService.name);

  constructor(private readonly prisma: PrismaClient) {}

  private readonly cartInclude = cartInclude;

  private getClient(tx?: Prisma.TransactionClient): ModelClient {
    return (tx ?? this.prisma) as unknown as ModelClient;
  }

  async getCartForCurrentUser(
    userId: number,
    options: { createIfMissing?: boolean; tx?: Prisma.TransactionClient } = {},
  ): Promise<CartWithItems | null> {
    const cart = await this.getActiveCartForContext({ userId }, options.tx);
    if (cart) return cart;

    if (options.createIfMissing) {
      const client = this.getClient(options.tx);
      return client.cart.create({
        data: { userId },
        include: this.cartInclude,
      });
    }

    return null;
  }

  async getActiveCartForRequest(
    req: Request,
    contextOverride?: CartContext,
    tx?: Prisma.TransactionClient,
  ): Promise<CartWithItems | null> {
    const context = contextOverride ?? this.buildContextFromRequest(req);
    return this.getActiveCartForContext(context, tx);
  }

  async getCheckoutCartForRequest(
    req: Request,
    tx?: Prisma.TransactionClient,
  ): Promise<CartWithItems | null> {
    const client = this.getClient(tx);

    const user = req.user as { id?: number } | undefined;
    const userId = typeof user?.id === 'number' ? user.id : undefined;

    const cookies = (req as Request & {
      cookies?: Record<string, string | undefined>;
    }).cookies;
    const anonymousId = cookies?.cartId;

    const [userCart, anonCart] = await Promise.all([
      userId
        ? client.cart.findFirst({
            where: { userId },
            include: this.cartInclude,
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve<CartWithItems | null>(null),
      anonymousId
        ? client.cart.findFirst({
            where: { anonymousId },
            include: this.cartInclude,
            orderBy: { createdAt: 'desc' },
          })
        : Promise.resolve<CartWithItems | null>(null),
    ]);

    if (anonCart && Array.isArray(anonCart.items) && anonCart.items.length > 0) {
      return anonCart;
    }

    if (userCart && Array.isArray(userCart.items) && userCart.items.length > 0) {
      return userCart;
    }

    return userCart ?? anonCart ?? null;
  }

  async getOrCreateCart(context: CartContext): Promise<CartWithItems> {
    const where = this.buildUniqueWhere(context);
    return this.findOrCreate(where);
  }

  async addItem(context: CartContext, dto: AddItemDto): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const client = this.getClient(tx);
      const where = this.buildUniqueWhere(context);
      const cart = await this.findOrCreate(where, tx);

      const variant = await this.getVariantOrThrow(client, dto.variantId);
      const price = variant.price;

      if (price == null) {
        throw new BadRequestException(VARIANT_PRICE_NOT_SET_ERROR);
      }

      const existingItem = await client.cartItem.findUnique({
        where: {
          cartId_variantId: {
            cartId: cart.id,
            variantId: dto.variantId,
          },
        },
      });

      const currentQty = existingItem?.qty ?? 0;
      const newQty = currentQty + dto.qty;

      this.assertStock(newQty, variant.stockQty ?? 0);

      if (existingItem) {
        await client.cartItem.update({
          where: { id: existingItem.id },
          data: { qty: newQty },
        });
      } else {
        await client.cartItem.create({
          data: {
            cartId: cart.id,
            variantId: dto.variantId,
            qty: dto.qty,
            priceAtAdd: price,
          },
        });
      }

      await this.recalcTotals(client, cart.id);
      return this.getCartByIdOrThrow(client, cart.id);
    });
  }

  async updateItem(
    context: CartContext,
    itemId: number,
    dto: UpdateItemDto,
  ): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const client = this.getClient(tx);
      const cart = await this.getCartForContext(context, client);

      const item = await client.cartItem.findUnique({ where: { id: itemId } });
      if (!item || item.cartId !== cart.id) {
        throw new NotFoundException(ITEM_NOT_FOUND_ERROR);
      }

      const variant = await this.getVariantOrThrow(client, item.variantId);
      this.assertStock(dto.qty, variant.stockQty ?? 0);

      await client.cartItem.update({
        where: { id: itemId },
        data: { qty: dto.qty },
      });

      await this.recalcTotals(client, cart.id);
      return this.getCartByIdOrThrow(client, cart.id);
    });
  }

  async removeItem(context: CartContext, itemId: number): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const client = this.getClient(tx);
      const cart = await this.getCartForContext(context, client);

      const item = await client.cartItem.findUnique({ where: { id: itemId } });
      if (!item || item.cartId !== cart.id) {
        throw new NotFoundException(ITEM_NOT_FOUND_ERROR);
      }

      await client.cartItem.delete({ where: { id: itemId } });
      await this.recalcTotals(client, cart.id);
      return this.getCartByIdOrThrow(client, cart.id);
    });
  }

  async clearCart(context: CartContext): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const client = this.getClient(tx);
      const where = this.buildUniqueWhere(context);
      const cart = await this.findOrCreate(where, tx);

      await client.cartItem.deleteMany({ where: { cartId: cart.id } });
      await this.recalcTotals(client, cart.id);
      return this.getCartByIdOrThrow(client, cart.id);
    });
  }

  async mergeOnLogin(userId: number, anonymousId?: string): Promise<MergeOnLoginResult> {
    if (!anonymousId) {
      return { merged: false, incidents: [] };
    }

    return this.prisma.$transaction(async (tx) => {
      const client = this.getClient(tx);

      const [anonCart, userCart] = await Promise.all([
        client.cart.findUnique({
          where: { anonymousId },
          include: { items: true },
        }),
        client.cart.findUnique({
          where: { userId },
          include: { items: true },
        }),
      ]);

      if (!anonCart) {
        return { merged: false, incidents: [] };
      }

      const incidents: CartMergeIncident[] = [];

      if (!userCart) {
        await client.cart.update({
          where: { id: anonCart.id },
          data: { userId, anonymousId: null },
        });
        await this.recalcTotals(client, anonCart.id);
        return { merged: true, incidents };
      }

      const existingItemsMap = new Map<number, number>(
        userCart.items.map((item) => [item.variantId, item.qty]),
      );

      for (const item of anonCart.items) {
        const currentQty = existingItemsMap.get(item.variantId) ?? 0;
        const requestedTotalQty = currentQty + item.qty;

        const variant = await this.getVariantOrThrow(client, item.variantId);
        const availableStock = Math.max(0, variant.stockQty ?? 0);
        const mergedQty = Math.min(requestedTotalQty, availableStock);

        if (mergedQty <= 0) {
          incidents.push({
            variantId: item.variantId,
            requestedQty: requestedTotalQty,
            mergedQty: 0,
            availableStock,
            reason: 'INSUFFICIENT_STOCK',
          });
          continue;
        }

        if (mergedQty < requestedTotalQty) {
          incidents.push({
            variantId: item.variantId,
            requestedQty: requestedTotalQty,
            mergedQty,
            availableStock,
            reason: 'INSUFFICIENT_STOCK',
          });
        }

        const existingItem = userCart.items.find((i) => i.variantId === item.variantId);

        if (existingItem) {
          await client.cartItem.update({
            where: { id: existingItem.id },
            data: { qty: mergedQty },
          });
          existingItem.qty = mergedQty;
        } else {
          const created = await client.cartItem.create({
            data: {
              cartId: userCart.id,
              variantId: item.variantId,
              qty: mergedQty,
              priceAtAdd: item.priceAtAdd,
            },
            select: { id: true, variantId: true, qty: true },
          });

          userCart.items.push({
            ...item,
            id: created.id,
            cartId: userCart.id,
            qty: mergedQty,
          });
        }

        existingItemsMap.set(item.variantId, mergedQty);
      }

      await client.cart.delete({ where: { id: anonCart.id } });
      await this.recalcTotals(client, userCart.id);

      if (incidents.length > 0) {
        this.logger.warn(
          `Merge guest->user con incidencias para userId=${userId}: ${JSON.stringify(incidents)}`,
        );
      }

      return { merged: true, incidents };
    });
  }

  private buildUniqueWhere(context: CartContext): Prisma.CartWhereUniqueInput {
    if (typeof context.userId === 'number') {
      return { userId: context.userId };
    }

    if (context.anonymousId) {
      return { anonymousId: context.anonymousId };
    }

    throw new BadRequestException(NO_CONTEXT_ERROR);
  }

  private buildContextFromRequest(req: Request): CartContext {
    const user = req.user as { id?: number } | undefined;
    const userId = typeof user?.id === 'number' ? user.id : undefined;

    const cookies = (req as Request & {
      cookies?: Record<string, string | undefined>;
    }).cookies;
    const anonymousId = cookies?.cartId;

    const context: CartContext = {};

    if (userId) {
      context.userId = userId;
    } else if (anonymousId) {
      context.anonymousId = anonymousId;
    }

    return context;
  }

  private async getActiveCartForContext(
    context: CartContext,
    tx?: Prisma.TransactionClient,
  ): Promise<CartWithItems | null> {
    const client = this.getClient(tx);

    if (typeof context.userId === 'number') {
      return client.cart.findFirst({
        where: { userId: context.userId },
        include: this.cartInclude,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (context.anonymousId) {
      return client.cart.findFirst({
        where: { anonymousId: context.anonymousId },
        include: this.cartInclude,
        orderBy: { createdAt: 'desc' },
      });
    }

    return null;
  }

  private buildCreateData(
    where: Prisma.CartWhereUniqueInput,
  ): Prisma.CartUncheckedCreateInput {
    return {
      userId: 'userId' in where ? where.userId : undefined,
      anonymousId:
        'anonymousId' in where ? where.anonymousId ?? randomUUID() : undefined,
    };
  }

  private async findOrCreate(
    where: Prisma.CartWhereUniqueInput,
    tx?: Prisma.TransactionClient,
  ): Promise<CartWithItems> {
    const client = this.getClient(tx);

    const existing = await client.cart.findUnique({
      where,
      include: this.cartInclude,
    });

    if (existing) {
      return existing;
    }

    const data = this.buildCreateData(where);

    return client.cart.create({
      data,
      include: this.cartInclude,
    });
  }

  private async getCartForContext(
    context: CartContext,
    client: ModelClient,
  ): Promise<CartWithItems> {
    const where = this.buildUniqueWhere(context);
    const cart = await client.cart.findUnique({
      where,
      include: this.cartInclude,
    });

    if (!cart) {
      throw new NotFoundException(CART_NOT_FOUND_ERROR);
    }

    return cart;
  }

  private async getCartByIdOrThrow(
    client: ModelClient,
    cartId: number,
  ): Promise<CartWithItems> {
    const cart = await client.cart.findUnique({
      where: { id: cartId },
      include: this.cartInclude,
    });

    if (!cart) {
      throw new NotFoundException(CART_NOT_FOUND_ERROR);
    }

    return cart;
  }

  private async getVariantOrThrow(client: ModelClient, variantId: number) {
    const variant = await client.productVariant.findUnique({
      where: { id: variantId },
    });

    if (!variant) {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }

    return variant;
  }

  private assertStock(required: number, stock: number) {
    if (required > stock) {
      throw new BadRequestException(INSUFFICIENT_STOCK_ERROR);
    }
  }

  private async recalcTotals(client: ModelClient, cartId: number) {
    const items = await client.cartItem.findMany({
      where: { cartId },
    });

    const itemsCount = items.reduce((s, it) => s + it.qty, 0);
    const subtotal = items.reduce((s, it) => s + it.qty * it.priceAtAdd, 0);

    await client.cart.update({
      where: { id: cartId },
      data: { itemsCount, subtotal },
    });
  }
}
