/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { renderCartShipping } from '../common/routing/cart-shipping';
import { ShippingMethodCode } from '../common/enums/shipping-method-code.enum';
const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');
const methods = [
  { id: 1, code: ShippingMethodCode.STANDARD, label: 'Envío estándar', priceCents: 490, amountCents: 490 },
  { id: 2, code: ShippingMethodCode.EXPRESS, label: 'Envío express', priceCents: 790, amountCents: 790 },
];

it('keeps initial shipping controls and distinguishes initial loading from updates and errors', async () => {
  const dom = new JSDOM(renderCartShipping(read('cart.html'), methods), { url: 'http://localhost:3000/cesta', runScripts: 'outside-only' });
  const app = dom.window as any;
  const document = dom.window.document;
  const radios = Array.from(document.querySelectorAll<HTMLInputElement>('#shippingOptions input'));
  expect(radios.map(input => input.value)).toEqual(['STANDARD', 'EXPRESS']);
  expect(radios[0].checked).toBe(true);
  // A selection made before deferred scripts run remains the selected method.
  radios[1].checked = true;
  const cartState = { data: null as any, status: 'loading', error: null as string | null };
  app.CRONOX_CART = { state: cartState };
  app.CRONOX_API = { getCheckoutSummary: async ({ shippingMethod }: { shippingMethod: string }) => {
    const selectedShippingMethod = methods.find(method => method.code === shippingMethod);
    return { shippingMethods: methods, selectedShippingMethod, totals: { shippingCents: selectedShippingMethod!.amountCents, totalCents: 4000 + selectedShippingMethod!.amountCents } };
  } };
  app.CRONOX_CART_READY = new Promise(() => {});
  app.eval(read('assets/cart.js'));
  await new Promise(resolve => setTimeout(resolve, 0));
  const status = document.querySelector<HTMLElement>('.cart-status')!;
  expect(status.classList.contains('cart-status--initial-loading')).toBe(true);
  expect(status.hidden).toBe(false);
  expect(status.textContent).toBe('Cargando cesta…');
  expect(Array.from(document.querySelectorAll('#shippingOptions input'))).toEqual(radios);
  cartState.data = { items: [{ id: 1, qty: 1, priceCents: 4000, product: { name: 'Test' } }], subtotalCents: 4000 };
  cartState.status = 'populated';
  app.dispatchEvent(new app.Event('cart:state'));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(status.hidden).toBe(true);
  expect(document.getElementById('sumShipping')?.textContent).toContain('Envío express');
  expect(document.getElementById('sumTotal')?.textContent).toContain('47,90');
  cartState.status = 'loading';
  app.dispatchEvent(new app.Event('cart:state'));
  expect(status.classList.contains('cart-status--initial-loading')).toBe(false);
  expect(status.textContent).toBe('Actualizando cesta…');
  cartState.data = null;
  cartState.status = 'error';
  cartState.error = 'Error de prueba';
  app.dispatchEvent(new app.Event('cart:state'));
  expect(status.classList.contains('cart-status--initial-loading')).toBe(false);
  expect(status.textContent).toContain('Error de prueba');
  expect(status.querySelector('button')?.textContent).toBe('Reintentar');
  dom.window.close();
});

it('renders one shared order estimate between items and recommendations and hides it after the last removal', async () => {
  const dom = new JSDOM(read('index.html'), { url: 'http://localhost:3000/', runScripts: 'outside-only' });
  const app = dom.window as any;
  app.scrollTo = () => {};
  app.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  app.fetch = async () => ({ ok: true, json: async () => ({}) });
  let cart = { items: [{ id: 1, qty: 1, variantId: 100, product: { name: 'Test one' }, priceCents: 2000 }], itemsCount: 1, subtotalCents: 2000 };
  app.CRONOX_API = {
    getCart: async () => cart,
    updateCartItem: async (_id: number, qty: number) => (cart = { ...cart, items: cart.items.map(item => ({ ...item, qty })) }),
    removeCartItem: async (id: number) => (cart = { ...cart, items: cart.items.filter(item => item.id !== id) }),
  };
  app.eval(read('assets/product-delivery.js'));
  app.eval(read('assets/app.js'));
  await app.CRONOX_CART.fetchCart();
  const notice = dom.window.document.querySelector<HTMLElement>('[data-cart-delivery]')!;
  expect(notice.hidden).toBe(false);
  expect(notice.parentElement!.id).toBe('cart-items-container');
  expect(notice.previousElementSibling!.classList.contains('cart-line')).toBe(true);
  expect(notice.nextElementSibling).toBeNull();
  expect(notice.parentElement!.nextElementSibling!.id).toBe('cart-upsell-section');
  expect(notice.querySelector('strong')!.textContent).toBe(app.CRONOX_DELIVERY.estimateProduct());
  cart.items.push({ id: 2, qty: 3, variantId: 200, product: { name: 'Test two' }, priceCents: 3000 });
  await app.CRONOX_CART.fetchCart();
  await app.CRONOX_CART.updateCartItem(1, 2);
  expect(dom.window.document.querySelectorAll('[data-cart-delivery]')).toHaveLength(1);
  expect(notice.hidden).toBe(false);
  expect(notice.parentElement!.lastElementChild).toBe(notice);
  await app.CRONOX_CART.removeCartItem(1);
  expect(notice.hidden).toBe(false);
  await app.CRONOX_CART.removeCartItem(2);
  expect(notice.hidden).toBe(true);
  expect(notice.querySelector('strong')!.textContent).toBe('');
  app.dispatchEvent(new app.Event('focus'));
  expect(notice.hidden).toBe(true);
  dom.window.close();
});
