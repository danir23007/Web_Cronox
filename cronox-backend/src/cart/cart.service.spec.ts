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
      checkoutSnapshot: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
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

  it('adopts guest ownership once and makes the old anonymous owner non-reusable', async () => {
    const anonymousCart = { id: 10, items: [] };
    let adopted = false;
    const tx = {
      cart: {
        findUnique: jest.fn(async ({ where }: any) => {
          if (where.anonymousId) return adopted ? null : anonymousCart;
          if (where.userId) return adopted ? { id: 10, items: [] } : null;
          return null;
        }),
        update: jest.fn(async ({ data }: any) => {
          if (data.userId === 42 && data.anonymousId === null) adopted = true;
          return anonymousCart;
        }),
      },
      cartItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      checkoutSnapshot: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CartService(prisma as any);

    await expect(service.mergeOnLogin(42, 'guest-cookie')).resolves.toEqual({
      merged: true,
      incidents: [],
    });
    await expect(service.mergeOnLogin(42, 'guest-cookie')).resolves.toEqual({
      merged: false,
      incidents: [],
    });

    expect(tx.cart.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { userId: 42, anonymousId: null },
    });
    expect(tx.checkoutSnapshot.updateMany).toHaveBeenCalledWith({
      where: { anonymousId: 'guest-cookie', userId: null, cartId: 10 },
      data: { anonymousId: null, userId: 42 },
    });
  });

  it('rejects an add that bypasses the frontend when real variant stock is insufficient', async () => {
    const tx = {
      cart: {
        findUnique: jest.fn().mockResolvedValue({ id: 10, items: [] }),
      },
      cartItem: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      productVariant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7,
          stockQty: 0,
          isActive: true,
          price: 1200,
          product: { id: 3, isActive: true, price: 1200 },
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: any) => unknown) =>
        callback(tx),
      ),
    };
    const service = new CartService(prisma as any);

    await expect(
      service.addItem({ anonymousId: 'opaque-guest' }, { variantId: 7, qty: 1 }),
    ).rejects.toThrow('INSUFFICIENT_STOCK');
    expect(tx.productVariant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
  });
});
