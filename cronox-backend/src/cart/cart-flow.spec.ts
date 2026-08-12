import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { JwtAccessStrategy } from '../auth/strategies/jwt-access.strategy';
import { UsersService } from '../users/users.service';
import { CheckoutSummaryController } from '../orders/checkout-summary.controller';
import { OrdersService } from '../orders/orders.service';
import { PaymentsApiController } from '../payments/payments-api.controller';
import { PaymentIntentFactory } from '../payments/payment-intent.factory';
import { CartController } from './cart.controller';
import { CartContext, CartService } from './cart.service';

type TestCart = {
  id: number;
  userId: number | null;
  anonymousId: string | null;
  itemsCount: number;
  subtotal: number;
  items: Array<{
    id: number;
    variantId: number;
    qty: number;
    priceAtAdd: number;
  }>;
};

class InMemoryCartService {
  private nextCartId = 1;
  private nextItemId = 1;
  private readonly carts = new Map<string, TestCart>();

  private key(context: CartContext) {
    if (typeof context.userId === 'number') return `user:${context.userId}`;
    if (context.anonymousId) return `anonymous:${context.anonymousId}`;
    throw new Error('NO_CONTEXT');
  }

  private contextFromRequest(req: any): CartContext {
    return typeof req.user?.id === 'number'
      ? { userId: req.user.id }
      : { anonymousId: req.cookies?.cartId };
  }

  async getActiveCartForRequest(_req: unknown, context: CartContext) {
    return this.carts.get(this.key(context)) ?? null;
  }

  async getOrCreateCart(context: CartContext): Promise<TestCart> {
    const key = this.key(context);
    let cart = this.carts.get(key);
    if (!cart) {
      cart = {
        id: this.nextCartId++,
        userId: context.userId ?? null,
        anonymousId: context.anonymousId ?? null,
        itemsCount: 0,
        subtotal: 0,
        items: [],
      };
      this.carts.set(key, cart);
    }
    return cart;
  }

  async addItem(context: CartContext, dto: { variantId: number; qty: number }) {
    const cart = await this.getOrCreateCart(context);
    const existing = cart.items.find(
      (item) => item.variantId === dto.variantId,
    );
    if (existing) existing.qty += dto.qty;
    else {
      cart.items.push({
        id: this.nextItemId++,
        variantId: dto.variantId,
        qty: dto.qty,
        priceAtAdd: 3495,
      });
    }
    this.recalculate(cart);
    return cart;
  }

  async updateItem(context: CartContext, itemId: number, dto: { qty: number }) {
    const cart = await this.getOrCreateCart(context);
    const item = cart.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error('ITEM_NOT_FOUND');
    item.qty = dto.qty;
    this.recalculate(cart);
    return cart;
  }

  async removeItem(context: CartContext, itemId: number) {
    const cart = await this.getOrCreateCart(context);
    cart.items = cart.items.filter((item) => item.id !== itemId);
    this.recalculate(cart);
    return cart;
  }

  async clearCart(context: CartContext) {
    const cart = await this.getOrCreateCart(context);
    cart.items = [];
    this.recalculate(cart);
    return cart;
  }

  async getCheckoutCartForRequest(req: any) {
    // Mirrors the production invariant: checkout never selects cartId when a
    // user was authenticated by the required JWT guard.
    if (typeof req.user?.id === 'number') {
      return this.carts.get(`user:${req.user.id}`) ?? null;
    }
    return req.cookies?.cartId
      ? this.carts.get(`anonymous:${req.cookies.cartId}`) ?? null
      : null;
  }

  private recalculate(cart: TestCart) {
    cart.itemsCount = cart.items.reduce((total, item) => total + item.qty, 0);
    cart.subtotal = cart.items.reduce(
      (total, item) => total + item.qty * item.priceAtAdd,
      0,
    );
  }
}

describe('cart identity request flow', () => {
  const jwtSecret = 'cart-flow-test-secret-that-is-long-enough';
  const users = new Map([
    [1, { id: 1, email: 'one@example.test', role: 'USER', sessionVersion: 0 }],
    [2, { id: 2, email: 'two@example.test', role: 'USER', sessionVersion: 0 }],
  ]);
  const usersService = {
    findById: jest.fn(async (id: number) => users.get(id) ?? null),
    toSafeUser: jest.fn((user: any) => user),
  };
  const ordersService = {
    getCheckoutSummary: jest.fn(async (cart: TestCart | null) => ({ cart })),
  };
  const paymentFactory = {
    createPaymentIntentForUser: jest.fn(),
    createPaymentIntentForOwner: jest.fn(),
  };

  let app: INestApplication;
  let jwtService: JwtService;
  let originalSecret: string | undefined;

  beforeAll(async () => {
    originalSecret = process.env.JWT_ACCESS_SECRET;
    process.env.JWT_ACCESS_SECRET = jwtSecret;

    const module = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [
        CartController,
        CheckoutSummaryController,
        PaymentsApiController,
      ],
      providers: [
        JwtAccessStrategy,
        { provide: UsersService, useValue: usersService },
        { provide: CartService, useClass: InMemoryCartService },
        { provide: OrdersService, useValue: ordersService },
        { provide: PaymentIntentFactory, useValue: paymentFactory },
      ],
    }).compile();

    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    await app.init();
    jwtService = new JwtService({ secret: jwtSecret });
  });

  afterAll(async () => {
    await app.close();
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalSecret;
  });

  const authCookie = async (userId: number) => {
    const user = users.get(userId)!;
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      sv: user.sessionVersion,
    });
    return `jwt=${token}`;
  };

  it('supports guest add/get/update/remove with an HTTP-only server cart cookie', async () => {
    const agent = request.agent(app.getHttpServer());
    const added = await agent
      .post('/api/cart/items')
      .send({ variantId: 10, qty: 1 })
      .expect(201);

    const initialCookie = added.headers['set-cookie']?.[0] ?? '';
    expect(initialCookie).toMatch(
      /cartId=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    expect(initialCookie).toContain('Max-Age=3600');
    expect(initialCookie).toContain('Path=/api');
    expect(initialCookie).toContain('HttpOnly');
    expect(initialCookie).toContain('SameSite=Lax');
    expect(added.body).toMatchObject({ userId: null, itemsCount: 1 });

    const fetched = await agent.get('/api/cart').expect(200);
    expect(fetched.body.id).toBe(added.body.id);
    expect(fetched.body.items).toHaveLength(1);
    expect(fetched.headers['set-cookie']).toBeUndefined();

    const itemId = fetched.body.items[0].id;
    const updated = await agent
      .patch(`/api/cart/items/${itemId}`)
      .send({ qty: 3 })
      .expect(200)
      .expect(({ body }) => expect(body.itemsCount).toBe(3));
    expect(updated.headers['set-cookie']?.[0]).toContain('Max-Age=3600');
    await agent
      .delete(`/api/cart/items/${itemId}`)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));
  });

  it('isolates two opaque guest owners while preserving each cart across requests', async () => {
    const firstGuest = request.agent(app.getHttpServer());
    const secondGuest = request.agent(app.getHttpServer());

    const [firstAdded, secondAdded] = await Promise.all([
      firstGuest.post('/api/cart/items').send({ variantId: 411, qty: 1 }),
      secondGuest.post('/api/cart/items').send({ variantId: 422, qty: 2 }),
    ]);

    expect(firstAdded.status).toBe(201);
    expect(secondAdded.status).toBe(201);
    expect(firstAdded.body.id).not.toBe(secondAdded.body.id);

    const [firstCart, secondCart] = await Promise.all([
      firstGuest.get('/api/cart'),
      secondGuest.get('/api/cart'),
    ]);
    expect(firstCart.body.items).toEqual([
      expect.objectContaining({ variantId: 411, qty: 1 }),
    ]);
    expect(secondCart.body.items).toEqual([
      expect.objectContaining({ variantId: 422, qty: 2 }),
    ]);
  });

  it('supports authenticated CRUD and never lets cartId override the user cart', async () => {
    const cookie = await authCookie(1);
    const forgedCookie = `${cookie}; cartId=unrelated-attacker-cart`;
    const added = await request(app.getHttpServer())
      .post('/api/cart/items')
      .set('Cookie', forgedCookie)
      .send({ variantId: 20, qty: 1 })
      .expect(201);

    expect(added.body).toMatchObject({ userId: 1, anonymousId: null });
    expect(added.headers['set-cookie']).toBeUndefined();

    const fetched = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', forgedCookie)
      .expect(200);
    expect(fetched.body.id).toBe(added.body.id);

    const itemId = fetched.body.items[0].id;
    await request(app.getHttpServer())
      .patch(`/api/cart/items/${itemId}`)
      .set('Cookie', forgedCookie)
      .send({ qty: 2 })
      .expect(200)
      .expect(({ body }) => expect(body.itemsCount).toBe(2));
    await request(app.getHttpServer())
      .delete(`/api/cart/items/${itemId}`)
      .set('Cookie', forgedCookie)
      .expect(200)
      .expect(({ body }) => expect(body.items).toHaveLength(0));
  });

  it('returns the same user items from logged-in add-to-cart and checkout summary', async () => {
    const cookie = await authCookie(1);
    const added = await request(app.getHttpServer())
      .post('/api/cart/items')
      .set('Cookie', `${cookie}; cartId=forged`)
      .send({ variantId: 30, qty: 2 })
      .expect(201);
    const summary = await request(app.getHttpServer())
      .get('/api/checkout/summary')
      .set('Cookie', `${cookie}; cartId=forged`)
      .expect(200);

    expect(summary.body.cart.id).toBe(added.body.id);
    expect(summary.body.cart.items).toEqual(added.body.items);
  });

  it('creates a STANDARD PaymentIntent from the same authenticated checkout cart', async () => {
    paymentFactory.createPaymentIntentForUser.mockResolvedValueOnce({
      clientSecret: 'secret_test',
      paymentIntentId: 'pi_test',
    });
    const cookie = await authCookie(1);
    const summary = await request(app.getHttpServer())
      .get('/api/checkout/summary')
      .set('Cookie', cookie)
      .expect(200);

    const payment = await request(app.getHttpServer())
      .post('/api/payments/create-payment-intent')
      .set('Cookie', cookie)
      .send({ shippingMethod: 'STANDARD' })
      .expect(201);

    expect(payment.body).toEqual({
      clientSecret: 'secret_test',
      paymentIntentId: 'pi_test',
    });
    expect(paymentFactory.createPaymentIntentForUser).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ shippingMethod: 'STANDARD' }),
      expect.objectContaining({ id: summary.body.cart.id }),
    );
  });

  it('creates a guest PaymentIntent from the opaque anonymous cart owner', async () => {
    paymentFactory.createPaymentIntentForOwner.mockResolvedValueOnce({
      clientSecret: 'secret_guest',
      paymentIntentId: 'pi_guest',
    });
    const agent = request.agent(app.getHttpServer());
    const added = await agent
      .post('/api/cart/items')
      .send({ variantId: 40, qty: 1 })
      .expect(201);

    await agent.get('/api/checkout/summary').expect(200);
    const payment = await agent
      .post('/api/payments/create-payment-intent')
      .send({ shippingMethod: 'STANDARD', guestEmail: 'guest@example.test' })
      .expect(201);

    expect(payment.body).toEqual({
      clientSecret: 'secret_guest',
      paymentIntentId: 'pi_guest',
    });
    expect(paymentFactory.createPaymentIntentForOwner).toHaveBeenCalledWith(
      expect.objectContaining({
        anonymousId: expect.any(String),
        customerEmail: 'guest@example.test',
      }),
      expect.objectContaining({ shippingMethod: 'STANDARD' }),
      expect.objectContaining({ id: added.body.id, userId: null }),
    );
  });

  it('rejects guest PaymentIntent creation without a valid contact email', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/cart/items').send({ variantId: 50, qty: 1 }).expect(201);
    await agent
      .post('/api/payments/create-payment-intent')
      .send({ shippingMethod: 'STANDARD', guestEmail: 'invalid' })
      .expect(400);
    expect(paymentFactory.createPaymentIntentForOwner).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ guestEmail: 'invalid' }),
      expect.anything(),
    );
  });

  it('isolates carts between authenticated users', async () => {
    const userOne = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', await authCookie(1))
      .expect(200);
    const userTwo = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', await authCookie(2))
      .expect(200);

    expect(userTwo.body.id).not.toBe(userOne.body.id);
    expect(userTwo.body.items).toEqual([]);
  });

  it('rejects present but invalid access credentials instead of downgrading to guest', async () => {
    await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', 'jwt=forged-token; cartId=forged-cart')
      .expect(401);
  });

  it('still rejects unauthenticated payment attempts', async () => {
    paymentFactory.createPaymentIntentForUser.mockClear();
    await request(app.getHttpServer())
      .post('/api/payments/create-payment-intent')
      .send({ shippingMethod: 'STANDARD' })
      .expect(401);
    expect(paymentFactory.createPaymentIntentForUser).not.toHaveBeenCalled();
  });
});
