import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

describe('newsletter account continuation after purchase', () => {
  it.each(['paid', 'pending', 'refunded', 'wrong-ref', 'expired', 'missing'])(
    'offers optional verified account access only for a processed matching purchase: %s', async scenario => {
      const root = path.resolve(__dirname, '../../../cronox-front');
      const dom = new JSDOM(readFileSync(path.join(root, 'checkout-success.html'), 'utf8'), { runScripts: 'outside-only', url: 'https://example.test/checkout/exito?ref=pi_fixture' });
      const w = dom.window as any;
      try {
        const hint = { email: 'guest@example.test', providerRef: scenario === 'wrong-ref' ? 'pi_other' : 'pi_fixture', createdAt: Date.now() - (scenario === 'expired' ? 25 * 60 * 60_000 : 0) };
        if (scenario !== 'missing') w.sessionStorage.setItem('cronoxNewsletterAfterPurchase', JSON.stringify(hint));
        w.CRONOX_API = { getCart: jest.fn().mockResolvedValue({ items: [] }) };
        w.CRONOX_AUTH_READY = Promise.resolve(null);
        w.CRONOX_openAuthModal = jest.fn().mockResolvedValue(true);
        w.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ found: true, isProcessed: scenario !== 'pending', orderStatus: scenario === 'pending' ? 'PENDING' : scenario === 'refunded' ? 'REFUNDED' : 'PAID' }) });
        w.eval(readFileSync(path.join(root, 'assets/checkout-success.js'), 'utf8'));
        await new Promise(resolve => setImmediate(resolve));
        expect(w.CRONOX_openAuthModal).not.toHaveBeenCalled();
        expect(w.document.getElementById('checkout-success-account').hidden).toBe(scenario !== 'paid');
        if (scenario === 'paid') {
          w.document.getElementById('checkout-success-account-button').click();
          await new Promise(resolve => setImmediate(resolve));
          expect(w.CRONOX_openAuthModal).toHaveBeenCalledWith('login', expect.objectContaining({ newsletterEmail: hint.email, accountExists: true }));
          expect(w.sessionStorage.getItem('cronoxNewsletterAfterPurchase')).toBeNull();
        }
      } finally { dom.window.close(); }
    },
  );
});

describe('checkout success cart synchronization', () => {
  it.each([false, true])('checks the backend on cancelled redirects, even when already processed=%s', async processed => {
    const source = readFileSync(path.resolve(__dirname, '../../../cronox-front/assets/checkout-success.js'), 'utf8');
    const nodes = new Map<string, any>();
    const getCart = jest.fn().mockResolvedValue({items:[]});
    const fetch = jest.fn().mockResolvedValue({ok:true,status:200,json:async()=>({found:true,isProcessed:processed,orderStatus:processed?'PAID':null,orderId:processed?1:null})});
    const document = {title:'',getElementById:(id:string)=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}};
    vm.runInNewContext(source, {
      window:{location:{search:'?ref=pi_fixture&redirect_status=failed'},CRONOX_API:{getCart},dispatchEvent:jest.fn()},
      document,fetch,URLSearchParams,console:{warn:jest.fn()},Date,Promise,encodeURIComponent,CustomEvent:class {},
      setTimeout:(callback:()=>void)=>callback(),
    });
    await new Promise<void>(resolve=>setImmediate(resolve));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getCart).toHaveBeenCalledTimes(processed?1:0);
    expect(document.title).toContain(processed?'Pedido confirmado':'No se ha completado');
    if(!processed) expect(nodes.get('checkout-success-cta').href).toBe('/checkout');
  });
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
