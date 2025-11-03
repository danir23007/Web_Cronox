import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

export type CartWithItems = Prisma.CartGetPayload<{
  include: {
    items: {
      include: {
        variant: { include: { product: true } };
      };
    };
  };
}>;

export type CartContext = {
  userId?: number;
  anonymousId?: string;
};

const INSUFFICIENT_STOCK_ERROR = 'INSUFFICIENT_STOCK';
const ITEM_NOT_FOUND_ERROR = 'ITEM_NOT_FOUND';

export type Client = Prisma.TransactionClient | PrismaClient;

type VariantWithProduct = Prisma.ProductVariantGetPayload<{
  include: { product: true };
}>;

@Injectable()
export class CartService {
  private readonly cartInclude = {
    items: {
      include: {
        variant: {
          include: {
            product: true,
          },
        },
      },
      orderBy: { id: 'asc' as const },
    },
  } as const;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaClient) {}

  async getOrCreateCart(opts: CartContext): Promise<CartWithItems> {
    const record = await this.ensureCart(this.prisma, opts);
    const cart = await this.getCartWithItems(record.id, this.prisma);

    if (!cart) {
      throw new NotFoundException('Cart not found');
    }

    return cart;
  }

  async addItem(opts: CartContext, dto: AddItemDto): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const cart = await this.ensureCart(tx, opts);

      const existingItem = await tx.cartItem.findUnique({
        where: {
          cartId_variantId: {
            cartId: cart.id,
            variantId: dto.variantId,
          },
        },
      });

      const currentQty = existingItem?.qty ?? 0;
      const newQty = currentQty + dto.qty;

      const variant = await this.ensureVariantStock(tx, dto.variantId, newQty);

      if (existingItem) {
        await tx.cartItem.update({
          where: { id: existingItem.id },
          data: { qty: newQty },
        });
      } else {
        const priceAtAdd = variant.price ?? variant.product.price;

        await tx.cartItem.create({
          data: {
            cartId: cart.id,
            variantId: dto.variantId,
            qty: dto.qty,
            priceAtAdd,
          },
        });
      }

      await this.recalculateCartTotals(tx, cart.id);

      const updated = await this.getCartWithItems(cart.id, tx);

      if (!updated) {
        throw new NotFoundException('Cart not found');
      }

      return updated;
    });
  }

  async updateItem(
    opts: CartContext,
    itemId: number,
    dto: UpdateItemDto,
  ): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const cart = await this.findCart(tx, opts);

      if (!cart) {
        throw new NotFoundException(ITEM_NOT_FOUND_ERROR);
      }

      const item = await tx.cartItem.findUnique({ where: { id: itemId } });

      if (!item || item.cartId !== cart.id) {
        throw new NotFoundException(ITEM_NOT_FOUND_ERROR);
      }

      await this.ensureVariantStock(tx, item.variantId, dto.qty);

      await tx.cartItem.update({ where: { id: itemId }, data: { qty: dto.qty } });

      await this.recalculateCartTotals(tx, cart.id);

      const updated = await this.getCartWithItems(cart.id, tx);

      if (!updated) {
        throw new NotFoundException('Cart not found');
      }

      return updated;
    });
  }

  async removeItem(opts: CartContext, itemId: number): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const cart = await this.findCart(tx, opts);

      if (!cart) {
        throw new NotFoundException(ITEM_NOT_FOUND_ERROR);
      }

      const item = await tx.cartItem.findUnique({ where: { id: itemId } });

      if (!item || item.cartId !== cart.id) {
        throw new NotFoundException(ITEM_NOT_FOUND_ERROR);
      }

      await tx.cartItem.delete({ where: { id: itemId } });

      await this.recalculateCartTotals(tx, cart.id);

      const updated = await this.getCartWithItems(cart.id, tx);

      if (!updated) {
        throw new NotFoundException('Cart not found');
      }

      return updated;
    });
  }

  async clearCart(opts: CartContext): Promise<CartWithItems> {
    return this.prisma.$transaction(async (tx) => {
      const cart = await this.ensureCart(tx, opts);

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });

      await this.recalculateCartTotals(tx, cart.id);

      const updated = await this.getCartWithItems(cart.id, tx);

      if (!updated) {
        throw new NotFoundException('Cart not found');
      }

      return updated;
    });
  }

  async mergeOnLogin(userId: number, anonymousId?: string): Promise<void> {
    if (!anonymousId) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const [anonCart, userCart] = await Promise.all([
        tx.cart.findUnique({
          where: { anonymousId },
          include: { items: true },
        }),
        tx.cart.findUnique({
          where: { userId },
          include: { items: true },
        }),
      ]);

      if (!anonCart) {
        return;
      }

      if (!userCart) {
        await tx.cart.update({
          where: { id: anonCart.id },
          data: { userId, anonymousId: null },
        });
        await this.recalculateCartTotals(tx, anonCart.id);
        return;
      }

      const existingItemsMap = new Map<number, number>(
        userCart.items.map((item) => [item.variantId, item.qty]),
      );

      for (const item of anonCart.items) {
        const currentQty = existingItemsMap.get(item.variantId) ?? 0;
        const newQty = currentQty + item.qty;

        await this.ensureVariantStock(tx, item.variantId, newQty);

        const existingItem = userCart.items.find((i) => i.variantId === item.variantId);

        if (existingItem) {
          await tx.cartItem.update({
            where: { id: existingItem.id },
            data: { qty: newQty },
          });
          existingItem.qty = newQty;
          existingItemsMap.set(item.variantId, newQty);
        } else {
          const created = await tx.cartItem.create({
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
          existingItemsMap.set(item.variantId, newQty);
        }
      }

      await tx.cart.delete({ where: { id: anonCart.id } });

      await this.recalculateCartTotals(tx, userCart.id);
    });
  }

  private buildUniqueWhere(opts: CartContext): Prisma.CartWhereUniqueInput | null {
    if (opts.userId) {
      return { userId: opts.userId };
    }

    if (opts.anonymousId) {
      return { anonymousId: opts.anonymousId };
    }

    return null;
  }

  private async ensureCart(client: Client, opts: CartContext) {
    const where = this.buildUniqueWhere(opts);

    if (!where) {
      throw new BadRequestException('CART_CONTEXT_REQUIRED');
    }

    const existing = await client.cart.findUnique({ where });

    if (existing) {
      return existing;
    }

    return client.cart.create({ data: where });
  }

  private async findCart(client: Client, opts: CartContext) {
    const where = this.buildUniqueWhere(opts);

    if (!where) {
      return null;
    }

    return client.cart.findUnique({ where });
  }

  private async getCartWithItems(cartId: number, client: Client) {
    return client.cart.findUnique({
      where: { id: cartId },
      include: this.cartInclude,
    });
  }

  private async ensureVariantStock(
    client: Client,
    variantId: number,
    requiredQty: number,
  ): Promise<VariantWithProduct> {
    const variant = await client.productVariant.findUnique({
      where: { id: variantId },
      include: { product: true },
    });

    if (!variant) {
      throw new NotFoundException('VARIANT_NOT_FOUND');
    }

    if (requiredQty > variant.stock) {
      throw new BadRequestException(INSUFFICIENT_STOCK_ERROR);
    }

    return variant;
  }

  private async recalculateCartTotals(client: Client, cartId: number): Promise<void> {
    const items = await client.cartItem.findMany({
      where: { cartId },
      select: { qty: true, priceAtAdd: true },
    });

    const itemsCount = items.reduce((total, item) => total + item.qty, 0);
    const subtotal = items.reduce(
      (total, item) => total + item.qty * item.priceAtAdd,
      0,
    );

    await client.cart.update({
      where: { id: cartId },
      data: {
        itemsCount,
        subtotal,
      },
    });
  }
}
