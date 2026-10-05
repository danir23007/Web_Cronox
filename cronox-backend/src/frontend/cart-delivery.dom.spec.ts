/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../cronox-front', file), 'utf8');

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
  expect(notice.previousElementSibling!.id).toBe('cart-items-container');
  expect(notice.nextElementSibling!.id).toBe('cart-upsell-section');
  expect(notice.querySelector('strong')!.textContent).toBe(app.CRONOX_DELIVERY.estimateProduct());
  cart.items.push({ id: 2, qty: 3, variantId: 200, product: { name: 'Test two' }, priceCents: 3000 });
  await app.CRONOX_CART.fetchCart();
  await app.CRONOX_CART.updateCartItem(1, 2);
  expect(dom.window.document.querySelectorAll('[data-cart-delivery]')).toHaveLength(1);
  expect(notice.hidden).toBe(false);
  await app.CRONOX_CART.removeCartItem(1);
  expect(notice.hidden).toBe(false);
  await app.CRONOX_CART.removeCartItem(2);
  expect(notice.hidden).toBe(true);
  expect(notice.querySelector('strong')!.textContent).toBe('');
  app.dispatchEvent(new app.Event('focus'));
  expect(notice.hidden).toBe(true);
  dom.window.close();
});
