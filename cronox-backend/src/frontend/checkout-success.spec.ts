import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

describe('checkout success cart synchronization', () => {
  it('removes the redirect client secret while preserving the payment reference and backend check', async () => {
    const source = readFileSync(path.resolve(__dirname, '../../../cronox-front/assets/checkout-success.js'), 'utf8');
    const replaceState = jest.fn();
    const fetch = jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>({found:true,isProcessed:false,orderStatus:'PENDING',orderId:1})});
    vm.runInNewContext(source, {
      window:{location:{pathname:'/checkout/exito',hash:'',search:'?ref=pi_fixture&payment_intent_client_secret=fixture_secret&redirect_status=succeeded'},history:{replaceState}},
      document:{getElementById:()=>({})}, fetch, URLSearchParams, console:{warn:jest.fn()}, Date, Promise, encodeURIComponent,
      setTimeout:(callback:()=>void)=>callback(),
    });
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(replaceState).toHaveBeenCalledWith(null, '', '/checkout/exito?ref=pi_fixture&redirect_status=succeeded');
    expect(fetch.mock.calls[0][0]).toContain('providerRef=pi_fixture');
  });
  it.each(['PENDING', 'CANCELLED'])('never treats an unpaid %s order as paid or clears its cart', async (orderStatus) => {
    const source = readFileSync(path.resolve(__dirname, '../../../cronox-front/assets/checkout-success.js'), 'utf8');
    const elements = new Map<string, any>();
    const getCart = jest.fn();
    const fetch = jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>({found:true,isProcessed:false,orderStatus,orderId:1})});
    vm.runInNewContext(source, {
      window:{location:{search:'?ref=pi_fixture'},CRONOX_API:{getCart}},
      document:{getElementById:(id:string)=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:false});return elements.get(id);}},
      fetch,URLSearchParams,console:{warn:jest.fn()},Date,Promise,encodeURIComponent,
      setTimeout:(callback:()=>void)=>callback(),
    });
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(getCart).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(elements.get('checkout-success-title').textContent).toBe(orderStatus==='PENDING'?'Pedido pendiente de pago':'Pedido cancelado');
    expect(elements.get('checkout-success-cta').href).toBe(orderStatus==='PENDING'?'/checkout':'/cesta');
  });
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
