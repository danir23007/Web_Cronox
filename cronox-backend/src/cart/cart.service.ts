import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

type ModelClient = Pick<
  PrismaClient,
  'cart' | 'cartItem' | 'productVariant' | '$transaction'
>;

export type CartWithItems = Awaited<ReturnType<PrismaClient['cart']['findUnique']>>;

export type CartContext = {
  userId?: number;
  anonymousId?: string;
};

const NO_CONTEXT_ERROR = 'NO_CONTEXT';
const CART_NOT_FOUND_ERROR = 'CART_NOT_FOUND';
const ITEM_NOT_FOUND_ERROR = 'ITEM_NOT_FOUND';
const INSUFFICIENT_STOCK_ERROR = 'INSUFFICIENT_STOCK';
const VARIANT_PRICE_NOT_SET_ERROR = 'VARIANT_PRICE_NOT_SET';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaClient) {}

  private readonly cartInclude = {
    items: {
      include: {
        variant: { include: { product: true } },
      },
    },
  } as const;

  private getClient(tx?: Prisma.TransactionClient): ModelClient {
    return (tx ?? this.prisma) as unknown as ModelClient;
  }

  async getOrCreateCart(context: CartContext): Promise<CartWithItems> {
    const where = this.buildUniqueWhere(context);
    if (!where) {
      throw new BadRequestException(NO_CONTEXT_ERROR);
    }

    return this.findOrCreate(where);
  }

  async addItem(context: CartContext, dto: AddItemDto): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const client = this.getClient(tx);
      const where = this.buildUniqueWhere(context);

      if (!where) {
        throw new BadRequestException(NO_CONTEXT_ERROR);
      }

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

      this.assertStock(newQty, variant.stock);

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

      this.assertStock(dto.qty, variant.stock);

      await client.cartItem.update({ where: { id: itemId }, data: { qty: dto.qty } });

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

      if (!where) {
        throw new BadRequestException(NO_CONTEXT_ERROR);
      }

      const cart = await this.findOrCreate(where, tx);

      await client.cartItem.deleteMany({ where: { cartId: cart.id } });

      await this.recalcTotals(client, cart.id);
      return this.getCartByIdOrThrow(client, cart.id);
    });
  }

  async mergeOnLogin(userId: number, anonymousId?: string): Promise<void> {
    if (!anonymousId) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
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
        return;
      }

      if (!userCart) {
        await client.cart.update({
          where: { id: anonCart.id },
          data: { userId, anonymousId: null },
        });
        await this.recalcTotals(client, anonCart.id);
        return;
      }

      const existingItemsMap = new Map<number, number>(
        userCart.items.map((item) => [item.variantId, item.qty]),
      );

      for (const item of anonCart.items) {
        const currentQty = existingItemsMap.get(item.variantId) ?? 0;
        const newQty = currentQty + item.qty;

        const variant = await this.getVariantOrThrow(client, item.variantId);
        this.assertStock(newQty, variant.stock);

        const existingItem = userCart.items.find((i) => i.variantId === item.variantId);

        if (existingItem) {
          await client.cartItem.update({
            where: { id: existingItem.id },
            data: { qty: newQty },
          });
          existingItem.qty = newQty;
        } else {
          const created = await client.cartItem.create({
            data: {
              cartId: userCart.id,
              variantId: item.variantId,
              qty: item.qty,
              priceAtAdd: item.priceAtAdd,
            },
            select: { id: true, variantId: true, qty: true },
          });

          userCart.items.push({
            ...item,
            id: created.id,
            cartId: userCart.id,
          });
        }

        existingItemsMap.set(item.variantId, newQty);
      }

      await client.cart.delete({ where: { id: anonCart.id } });

      await this.recalcTotals(client, userCart.id);
    });
  }

  private buildUniqueWhere(context: CartContext): Prisma.CartWhereUniqueInput | null {
    if (typeof context.userId === 'number') {
      return { userId: context.userId };
    }

    if (context.anonymousId) {
      return { anonymousId: context.anonymousId };
    }

    return null;
  }

  private async findOrCreate(
    where: Prisma.CartWhereUniqueInput,
    tx?: Prisma.TransactionClient,
  ): Promise<CartWithItems> {
    const client = this.getClient(tx);
    const existing = await client.cart.findUnique({ where, include: this.cartInclude });

    if (existing) {
      return existing;
    }

    if ('anonymousId' in where && !where.anonymousId) {
      where.anonymousId = uuidv4();
    }

    return client.cart.create({ data: where, include: this.cartInclude });
  }

  private async getCartForContext(
    context: CartContext,
    client: ModelClient,
  ): Promise<CartWithItems> {
    const where = this.buildUniqueWhere(context);

    if (!where) {
      throw new BadRequestException(NO_CONTEXT_ERROR);
    }

    const cart = await client.cart.findUnique({ where, include: this.cartInclude });

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
    const variant = await client.productVariant.findUnique({ where: { id: variantId } });

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
    const items = await client.cartItem.findMany({ where: { cartId } });
    const itemsCount = items.reduce((sum, item) => sum + item.qty, 0);
    const subtotal = items.reduce((sum, item) => sum + item.qty * item.priceAtAdd, 0);

    await client.cart.update({
      where: { id: cartId },
      data: { itemsCount, subtotal },
    });
  }
}
