import {readFileSync} from 'node:fs';
import path from 'node:path';
import {JSDOM, VirtualConsole} from 'jsdom';
const read = (name: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', name), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('rejects stale shipping quotes, refreshes totals after mutations, and offers retry without guessing a price', async () => {
  const dom = new JSDOM(read('cart.html'), {url: 'http://localhost/cesta', runScripts: 'outside-only', virtualConsole: new VirtualConsole()});
  const win = dom.window as any;
  try {
    const data = (qty: number) => ({items: [{id: 1, qty, priceCents: 4000, product: {name: 'Fixture'}}], subtotalCents: 4000 * qty});
    const state = {data: data(1), status: 'populated', pending: false};
    const pending: {resolve: (v: any) => void; reject: (e: Error) => void; method: string}[] = [];
    win.CRONOX_CART = {state}; win.CRONOX_CART_READY = Promise.resolve(state.data);
    win.CRONOX_API = {getCheckoutSummary: ({shippingMethod}: any) => new Promise((resolve, reject) => pending.push({resolve, reject, method: shippingMethod}))};
    win.eval(read('assets/cart.js')); await tick();
    const total = win.document.getElementById('sumTotal');
    const pay = win.document.getElementById('btnCheckout');
    expect(pay.disabled).toBe(true); expect(total.textContent).toBe('—');
    state.data = data(2); win.dispatchEvent(new win.Event('cart:state'));
    const reply = (subtotal: number, shipping: number) => {
      const method = {code: 'STANDARD', label: 'Configurado', priceCents: 490, amountCents: shipping};
      return {shippingMethods: [method], selectedShippingMethod: method, totals: {subtotalCents: subtotal, shippingCents: shipping, totalCents: subtotal + shipping}};
    };
    pending.at(-1)!.resolve(reply(8000, 0)); await tick();
    pending[0].resolve(reply(4000, 490)); await tick();
    expect(total.textContent).toContain('80,00'); expect(pay.disabled).toBe(false);
    expect(win.document.querySelectorAll('#shippingOptions input')).toHaveLength(1);
    state.data = data(1); win.dispatchEvent(new win.Event('cart:state'));
    pending.at(-1)!.reject(new Error('offline')); await tick();
    expect(total.textContent).toBe('—'); expect(pay.disabled).toBe(true);
    const retry = win.document.querySelector('#shippingOptions + [role="status"] button');
    expect(retry.textContent).toBe('Reintentar'); retry.click();
    pending.at(-1)!.resolve(reply(4000, 590)); await tick();
    expect(total.textContent).toContain('45,90'); expect(pay.disabled).toBe(false);
    expect(win.document.querySelector('.shipping-option__price').textContent).toContain('5,90');
  } finally {dom.window.close();}
});
