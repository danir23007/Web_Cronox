import { CartService } from './cart.service';

describe('CartService checkout cart selection', () => {
  it('uses only the authenticated account cart and ignores an anonymous cookie cart', async () => {
    const prisma = {
      cart: {
        findFirst: jest.fn().mockResolvedValue({
          id: 7,
          userId: 42,
          items: [],
        }),
      },
    };
    const service = new CartService(prisma as any);

    const cart = await service.getCheckoutCartForRequest({
      user: { id: 42 },
      cookies: { cartId: 'untrusted-anonymous-cart' },
    } as any);

    expect(cart).toMatchObject({ id: 7, userId: 42 });
    expect(prisma.cart.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.cart.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 42 } }),
    );
  });

  it('merges guest quantities into existing user products with stock validation', async () => {
    const anonymousCart = {
      id: 10,
      items: [
        { id: 101, cartId: 10, variantId: 1, qty: 2, priceAtAdd: 1200 },
        { id: 102, cartId: 10, variantId: 2, qty: 5, priceAtAdd: 2400 },
      ],
    };
    const userCart = {
      id: 20,
      items: [{ id: 201, cartId: 20, variantId: 1, qty: 3, priceAtAdd: 1200 }],
    };
    const tx = {
      cart: {
        findUnique: jest.fn(async ({ where }: any) =>
          where.anonymousId ? anonymousCart : userCart,
        ),
        delete: jest.fn().mockResolvedValue(anonymousCart),
        update: jest.fn().mockResolvedValue(userCart),
      },
      cartItem: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 202, variantId: 2, qty: 5 }),
        findMany: jest.fn().mockResolvedValue([
          { qty: 4, priceAtAdd: 1200 },
          { qty: 5, priceAtAdd: 2400 },
        ]),
      },
      productVariant: {
        findUnique: jest.fn(async ({ where }: any) => ({
          id: where.id,
          stockQty: where.id === 1 ? 4 : 10,
          isActive: true,
          price: where.id === 1 ? 1200 : 2400,
          product: { id: where.id, isActive: true, price: 9999 },
        })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CartService(prisma as any);

    const result = await service.mergeOnLogin(42, 'guest-cookie');

    expect(result).toEqual({
      merged: true,
      incidents: [
        {
          variantId: 1,
          requestedQty: 5,
          mergedQty: 4,
          availableStock: 4,
          reason: 'INSUFFICIENT_STOCK',
        },
      ],
    });
    expect(tx.cartItem.update).toHaveBeenCalledWith({
      where: { id: 201 },
      data: { qty: 4 },
    });
    expect(tx.cartItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cartId: 20,
          variantId: 2,
          qty: 5,
          priceAtAdd: 2400,
        }),
      }),
    );
    expect(tx.cart.delete).toHaveBeenCalledWith({ where: { id: 10 } });
    expect(tx.cart.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { itemsCount: 9, subtotal: 16800 },
    });
  });
});
