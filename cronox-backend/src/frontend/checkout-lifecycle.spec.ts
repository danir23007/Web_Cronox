import path from 'node:path';

describe('checkout frontend lifecycle coordinator', () => {
  const coordinatorModule = jest.requireActual<{
    createCoordinator: () => {
      current: () => number;
      invalidate: () => number;
      isCurrent: (revision: number) => boolean;
      enqueue: (
        revision: number,
        task: (isCurrent: () => boolean) => Promise<boolean>,
      ) => Promise<boolean>;
    };
    pollUntilProcessed: (options: {
      fetchStatus: () => Promise<Record<string, unknown>>;
      onProcessed: (status: Record<string, unknown>) => Promise<void>;
      shouldContinue?: () => boolean;
      delay?: () => Promise<void>;
      intervalMs?: number;
      maxAttempts?: number;
    }) => Promise<{
      outcome: string;
      status: Record<string, unknown> | null;
    }>;
    confirmMountedPayment: (options: {
      stripe: { confirmPayment: jest.Mock };
      elements: Record<string, unknown>;
      paymentElementMounted: boolean;
      confirmParams: Record<string, unknown>;
      onFailure?: (error: unknown) => void;
    }) => Promise<{ attempted: boolean; error: unknown }>;
    confirmExpressPayment: (options: {
      stripe: { confirmPayment: jest.Mock };
      elements: Record<string, unknown>;
      expressCheckoutMounted: boolean;
      confirmParams: Record<string, unknown>;
      onFailure?: (error: unknown) => void;
    }) => Promise<{ attempted: boolean; error: unknown }>;
    observePaymentElementLoad: (options: {
      paymentElement: { on: jest.Mock };
      onReady: () => void;
      onLoadError: (error: unknown) => void;
    }) => boolean;
    getShippingDefaultValues: (options: {
      profile?: Record<string, unknown>;
      address?: Record<string, unknown>;
    }) => Record<string, string>;
    hasAvailableExpressWallet: (
      availablePaymentMethods?: Record<string, unknown>,
    ) => boolean;
    getProductVariants: (product: {
      variants?: Array<Record<string, unknown>>;
    }) => Array<Record<string, unknown>>;
    isProductVariantAvailable: (variant: Record<string, unknown>) => boolean;
    getAvailableProductVariants: (product: {
      variants?: Array<Record<string, unknown>>;
    }) => Array<Record<string, unknown>>;
    getProductIdentityKeys: (
      source: Record<string, unknown>,
    ) => string[];
    getCartProductExclusionKeys: (
      cartItems?: Array<Record<string, unknown>>,
    ) => Set<string> | null;
    getRecommendationCandidates: (options: {
      products: Array<Record<string, unknown>>;
      cartItems?: Array<Record<string, unknown>>;
      limit?: number;
    }) => Array<Record<string, unknown>>;
    getDirectAddVariant: (product: {
      variants?: Array<Record<string, unknown>>;
    }) => Record<string, unknown> | null;
    getPaymentButtonState: (options: {
      loading: boolean;
      authenticated: boolean;
      hasItems: boolean;
      shippingMethod: string;
      clientSecret: string | null;
      paymentElementMounted?: boolean;
    }) => { disabled: boolean; label: string };
  }>(
    path.resolve(
      __dirname,
      '../../../cronox-front/assets/checkout-lifecycle.js',
    ),
  );

  it('serializes rapid changes and prevents a stale response from committing', async () => {
    const coordinator = coordinatorModule.createCoordinator();
    const commits: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const firstRevision = coordinator.invalidate();
    const first = coordinator.enqueue(firstRevision, async (isCurrent) => {
      await firstGate;
      if (!isCurrent()) return false;
      commits.push('STANDARD');
      return true;
    });

    const secondRevision = coordinator.invalidate();
    const second = coordinator.enqueue(secondRevision, (isCurrent) => {
      if (!isCurrent()) return Promise.resolve(false);
      commits.push('EXPRESS');
      return Promise.resolve(true);
    });

    releaseFirst();

    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(commits).toEqual(['EXPRESS']);
    expect(coordinator.isCurrent(firstRevision)).toBe(false);
    expect(coordinator.isCurrent(secondRevision)).toBe(true);
  });

  it('polls a delayed succeeded webhook and commits only after order processing', async () => {
    const fetchStatus = jest
      .fn()
      .mockResolvedValueOnce({
        found: false,
        isProcessed: false,
        paymentPending: true,
      })
      .mockResolvedValueOnce({
        found: true,
        isProcessed: true,
        orderId: 16,
      });
    const onProcessed = jest.fn().mockResolvedValue(undefined);
    const delay = jest.fn().mockResolvedValue(undefined);

    await expect(
      coordinatorModule.pollUntilProcessed({
        fetchStatus,
        onProcessed,
        delay,
        maxAttempts: 3,
      }),
    ).resolves.toEqual({
      outcome: 'processed',
      status: { found: true, isProcessed: true, orderId: 16 },
    });
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    expect(delay).toHaveBeenCalledTimes(1);
    expect(onProcessed).toHaveBeenCalledTimes(1);
  });

  it('does not confirm payment until the Payment Element is mounted', async () => {
    const confirmPayment = jest.fn();

    await expect(
      coordinatorModule.confirmMountedPayment({
        stripe: { confirmPayment },
        elements: {},
        paymentElementMounted: false,
        confirmParams: {},
      }),
    ).resolves.toEqual({ attempted: false, error: null });
    expect(confirmPayment).not.toHaveBeenCalled();
  });

  it('reports a thrown Stripe confirmation so the pay button can be restored', async () => {
    const thrown = new Error('Stripe unavailable');
    let payButtonLoading = true;
    const onFailure = jest.fn(() => {
      payButtonLoading = false;
    });

    await expect(
      coordinatorModule.confirmMountedPayment({
        stripe: { confirmPayment: jest.fn().mockRejectedValue(thrown) },
        elements: {},
        paymentElementMounted: true,
        confirmParams: { return_url: 'http://localhost/success' },
        onFailure,
      }),
    ).resolves.toEqual({ attempted: true, error: thrown });
    expect(onFailure).toHaveBeenCalledWith(thrown);
    expect(payButtonLoading).toBe(false);
  });

  it('confirms Express Checkout only after its real Stripe Element is mounted', async () => {
    const confirmPayment = jest.fn().mockResolvedValue({});

    await expect(
      coordinatorModule.confirmExpressPayment({
        stripe: { confirmPayment },
        elements: {},
        expressCheckoutMounted: false,
        confirmParams: { return_url: 'https://example.com/checkout-success' },
      }),
    ).resolves.toEqual({ attempted: false, error: null });
    expect(confirmPayment).not.toHaveBeenCalled();

    await expect(
      coordinatorModule.confirmExpressPayment({
        stripe: { confirmPayment },
        elements: {},
        expressCheckoutMounted: true,
        confirmParams: { return_url: 'https://example.com/checkout-success' },
      }),
    ).resolves.toEqual({ attempted: true, error: null });
    expect(confirmPayment).toHaveBeenCalledWith({
      elements: {},
      confirmParams: {
        return_url: 'https://example.com/checkout-success',
      },
    });
  });

  it('surfaces an Express Checkout confirmation error for wallet recovery', async () => {
    const stripeError = { type: 'card_error', message: 'Wallet declined' };
    const onFailure = jest.fn();

    await expect(
      coordinatorModule.confirmExpressPayment({
        stripe: {
          confirmPayment: jest.fn().mockResolvedValue({ error: stripeError }),
        },
        elements: {},
        expressCheckoutMounted: true,
        confirmParams: { return_url: 'https://example.com/checkout-success' },
        onFailure,
      }),
    ).resolves.toEqual({ attempted: true, error: stripeError });
    expect(onFailure).toHaveBeenCalledWith(stripeError);
  });

  it('keeps accelerated checkout hidden when no real wallet is available', () => {
    expect(coordinatorModule.hasAvailableExpressWallet()).toBe(false);
    expect(
      coordinatorModule.hasAvailableExpressWallet({
        paypal: { available: false },
        googlePay: { available: false },
      }),
    ).toBe(false);
    expect(
      coordinatorModule.hasAvailableExpressWallet({
        paypal: false,
        googlePay: true,
      }),
    ).toBe(true);
    expect(
      coordinatorModule.hasAvailableExpressWallet({
        paypal: { available: true },
        googlePay: { available: false },
      }),
    ).toBe(true);
  });

  it('recommends only active in-stock products outside the current cart', () => {
    const products = [
      {
        id: 'in-cart',
        slug: 'in-cart',
        variants: [{ id: 1, stock: 3, isActive: true, isAvailable: true }],
      },
      {
        id: 'sold-out',
        slug: 'sold-out',
        variants: [{ id: 2, stock: 0, isActive: true, isAvailable: false }],
      },
      {
        id: 'inactive',
        slug: 'inactive',
        isActive: false,
        variants: [{ id: 3, stock: 4, isActive: true, isAvailable: true }],
      },
      {
        id: 'available',
        slug: 'available',
        variants: [{ id: 4, stock: 2, isActive: true, isAvailable: true }],
      },
    ];

    expect(
      coordinatorModule.getRecommendationCandidates({
        products,
        cartItems: [{ product: { id: 'in-cart', slug: 'in-cart' } }],
        limit: 3,
      }),
    ).toEqual([products[3]]);
  });

  it('excludes every cart product by stable id or slug', () => {
    const products = [
      { backendId: 101, slug: 'product-a', variants: [{ id: 1, stock: 2 }] },
      { backendId: 102, slug: 'product-b', variants: [{ id: 2, stock: 2 }] },
      { backendId: 103, slug: 'product-c', variants: [{ id: 3, stock: 2 }] },
    ];

    expect(
      coordinatorModule.getRecommendationCandidates({
        products,
        cartItems: [
          { product: { id: 101, slug: 'product-a' } },
          { product: { id: 102, slug: 'product-b' } },
        ],
        limit: 3,
      }),
    ).toEqual([products[2]]);
  });

  it('returns no recommendations until authoritative cart lines are available', () => {
    const products = [
      { backendId: 101, slug: 'product-a', variants: [{ id: 1, stock: 2 }] },
    ];
    expect(
      coordinatorModule.getRecommendationCandidates({ products }),
    ).toEqual([]);
    expect(coordinatorModule.getCartProductExclusionKeys()).toBeNull();
  });

  it('excludes a product across variants using the nested product identity', () => {
    const product = {
      backendId: 101,
      slug: 'product-a',
      variants: [
        { id: 1, size: 'M', stock: 2 },
        { id: 2, size: 'L', stock: 2 },
      ],
    };
    expect(
      coordinatorModule.getRecommendationCandidates({
        products: [product],
        cartItems: [
          { variant: { id: 2, product: { id: 101, slug: 'product-a' } } },
        ],
      }),
    ).toEqual([]);
  });

  it('uses stable identities instead of display-name comparison', () => {
    const sameNameDifferentProduct = {
      backendId: 202,
      slug: 'different-product',
      name: 'CORE TEE',
      variants: [{ id: 3, stock: 2 }],
    };
    expect(
      coordinatorModule.getRecommendationCandidates({
        products: [sameNameDifferentProduct],
        cartItems: [
          { product: { id: 101, slug: 'cart-product', name: 'CORE TEE' } },
        ],
      }),
    ).toEqual([sameNameDifferentProduct]);
    expect(
      coordinatorModule.getProductIdentityKeys(sameNameDifferentProduct),
    ).toEqual(expect.arrayContaining(['id:202', 'slug:different-product']));
  });

  it('quick-adds only a single available variant and never chooses among sizes', () => {
    const unique = { id: 8, size: 'Única', stock: 1, isAvailable: true };
    expect(
      coordinatorModule.getDirectAddVariant({ variants: [unique] }),
    ).toEqual(unique);
    expect(
      coordinatorModule.getDirectAddVariant({
        variants: [
          { id: 9, size: 'M', stock: 2, isAvailable: true },
          { id: 10, size: 'L', stock: 2, isAvailable: true },
        ],
      }),
    ).toBeNull();
  });

  it('keeps every existing recommendation size while availability remains stock-authoritative', () => {
    const variants = [
      { id: 21, size: 'XS', stock: 0, isActive: true, isAvailable: false },
      { id: 22, size: 'S', stock: 2, isActive: true, isAvailable: true },
      { id: 23, size: 'M', stockQty: 0, isActive: true },
      { id: 24, size: 'L', stockQty: 1, isActive: true },
    ];

    expect(coordinatorModule.getProductVariants({ variants })).toEqual(variants);
    expect(
      coordinatorModule.getAvailableProductVariants({ variants }),
    ).toEqual([variants[1], variants[3]]);
    expect(coordinatorModule.isProductVariantAvailable(variants[0])).toBe(false);
    expect(coordinatorModule.isProductVariantAvailable(variants[3])).toBe(true);
  });

  it('keeps payment disabled until ready and surfaces Payment Element load errors', () => {
    const handlers = new Map<string, (event?: unknown) => void>();
    const paymentElement = {
      on: jest.fn((event: string, handler: (payload?: unknown) => void) => {
        handlers.set(event, handler);
      }),
    };
    let mounted = false;
    let retryAvailable = false;

    expect(
      coordinatorModule.observePaymentElementLoad({
        paymentElement,
        onReady: () => {
          mounted = true;
        },
        onLoadError: () => {
          mounted = false;
          retryAvailable = true;
        },
      }),
    ).toBe(true);
    expect(mounted).toBe(false);

    handlers.get('ready')?.();
    expect(mounted).toBe(true);
    handlers.get('loaderror')?.({ error: { code: 'load_failed' } });
    expect(mounted).toBe(false);
    expect(retryAvailable).toBe(true);
  });

  it('prefills a valid logged-in default address without mutating it', () => {
    const profile = {
      firstName: 'Lucía',
      lastName: 'Santos',
      phone: '+34 600 123 456',
    };
    const defaultAddress = {
      name: 'Otro Nombre',
      line1: 'Calle Mayor 10',
      line2: '3º B',
      city: 'Madrid',
      state: 'Madrid',
      zip: '28013',
      country: 'es',
      isDefault: true,
    };

    expect(
      coordinatorModule.getShippingDefaultValues({
        profile,
        address: defaultAddress,
      }),
    ).toEqual({
      firstName: 'Lucía',
      lastName: 'Santos',
      country: 'España',
      address: 'Calle Mayor 10',
      addressLine2: '3º B',
      city: 'Madrid',
      state: 'Madrid',
      zip: '28013',
      phone: '+34 600 123 456',
    });
    expect(defaultAddress).toEqual(
      expect.objectContaining({ country: 'es', isDefault: true }),
    );
  });

  it('restores an enabled retry button after payment preparation fails', () => {
    expect(
      coordinatorModule.getPaymentButtonState({
        loading: true,
        authenticated: true,
        hasItems: true,
        shippingMethod: 'STANDARD',
        clientSecret: null,
      }),
    ).toEqual({ disabled: true, label: 'Procesando…' });

    expect(
      coordinatorModule.getPaymentButtonState({
        loading: false,
        authenticated: true,
        hasItems: true,
        shippingMethod: 'STANDARD',
        clientSecret: 'pi_secret',
        paymentElementMounted: false,
      }),
    ).toEqual({ disabled: true, label: 'Procesando…' });

    expect(
      coordinatorModule.getPaymentButtonState({
        loading: false,
        authenticated: true,
        hasItems: true,
        shippingMethod: 'STANDARD',
        clientSecret: 'pi_secret',
        paymentElementMounted: true,
      }),
    ).toEqual({ disabled: false, label: 'Pagar ahora' });

    expect(
      coordinatorModule.getPaymentButtonState({
        loading: false,
        authenticated: true,
        hasItems: true,
        shippingMethod: 'STANDARD',
        clientSecret: null,
      }),
    ).toEqual({ disabled: false, label: 'Reintentar pago' });
  });
});
