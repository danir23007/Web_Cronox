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
});
