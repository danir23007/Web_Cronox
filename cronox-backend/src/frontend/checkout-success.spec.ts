import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('checkout success cart synchronization', () => {
  it.each(['PAID', 'REFUNDED'])('waits for processed backend status and renders %s correctly', async (orderStatus) => {
    const source = readFileSync(
      path.resolve(
        __dirname,
        '../../../cronox-front/assets/checkout-success.js',
      ),
      'utf8',
    );
    const cart = {
      id: 10,
      items: [{ id: 22, variantId: 9, qty: 1 }],
      itemsCount: 1,
      subtotalCents: 2995,
    };
    const getCart = jest.fn().mockResolvedValue(cart);
    const dispatchEvent = jest.fn();
    const elements = new Map<string, Record<string, unknown>>();
    const document = {
      getElementById: jest.fn((id: string) => {
        if (!elements.has(id)) {
          elements.set(id, { textContent: '', hidden: true });
        }
        return elements.get(id);
      }),
    };
    class TestCustomEvent {
      constructor(
        public readonly type: string,
        public readonly init: { detail: unknown },
      ) {}
    }
    const window = {
      location: {
        search: '?payment_intent=pi_confirmed&redirect_status=succeeded',
      },
      CRONOX_API: { API_BASE: '', getCart },
      dispatchEvent,
    };
    const fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ found: false, isProcessed: false }),
    }).mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        found: true,
        isProcessed: true,
        orderId: 77,
        orderStatus,
      }),
    });

    vm.runInNewContext(source, {
      window,
      document,
      fetch,
      CustomEvent: TestCustomEvent,
      URLSearchParams,
      console: { warn: jest.fn() },
      localStorage: { removeItem: jest.fn() },
      setTimeout: (callback: () => void) => callback(),
      clearTimeout,
      Date,
      Promise,
      encodeURIComponent,
    });

    expect(elements.get('checkout-success-title')?.textContent).toBe('Validando pedido…');
    expect(getCart).not.toHaveBeenCalled();

    for (
      let attempt = 0;
      attempt < 10 && getCart.mock.calls.length === 0;
      attempt++
    ) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(fetch).toHaveBeenCalledWith(
      '/api/orders/payment-status?providerRef=pi_confirmed',
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(getCart).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(elements.get('checkout-success-title')?.textContent).toBe(
      orderStatus === 'REFUNDED' ? 'Pedido reembolsado' : 'Pedido confirmado',
    );
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cart:updated',
        init: { detail: cart },
      }),
    );
  });
});
