/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const pages = ['index.html', 'producto.html', 'favorites.html', 'profile.html', 'checkout.html',
  'gallery.html', 'faqs.html', 'shipping-policy.html', 'returns-exchanges.html', 'develop.html', 'events.html',
  'privacy-policy.html', 'cookie-policy.html', 'terms-of-service.html', 'aviso-legal.html', 'sobre-cronox.html'];

function open(page: string) {
  const html = read(page);
  const dom = new JSDOM(html, { url: `http://localhost:3000/nested/${page}`, runScripts: 'outside-only' });
  const app = dom.window as any;
  app.requestAnimationFrame = (callback: FrameRequestCallback) => { callback(0); return 1; };
  app.cancelAnimationFrame = () => {};
  app.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  app.scrollTo = () => {};
  app.fetch = async () => ({ ok: true, text: async () => read('auth-modal.html'), json: async () => [] });
  app.CRONOX_API = {
    getMe: async () => null, getFavorites: async () => [],
    getCart: async () => ({ items: [], itemsCount: 0, subtotalCents: 0 }),
    getAllCategories: async () => [{ name: 'Camisetas', slug: 'camisetas', group: 'GARMENT' }],
  };
  if (html.includes('assets/info-shell.js')) app.eval(read('assets/info-shell.js'));
  app.eval(read('assets/app.js'));
  return { app, dom, document: dom.window.document };
}

const finishClosing = () => new Promise(resolve => setTimeout(resolve, 320));

describe('shared public navigation menu', () => {
  it('does not mount navigation or its trigger on the cart page or inside the cart drawer', async () => {
    for (const page of ['cart.html', 'index.html']) {
      const { dom, document } = open(page);
      expect(document.querySelector('#cart-drawer [data-open-filters]')).toBeNull();
      expect(document.querySelector('#cart-drawer .black-menu')).toBeNull();
      if (page === 'cart.html') {
        expect(document.getElementById('btnMenu')).toBeNull();
        expect(document.getElementById('filtersPanel')).toBeNull();
      }
      await new Promise(resolve => setTimeout(resolve, 0));
      dom.window.close();
    }
  });
  it.each(pages)('%s uses the sole body-mounted component and a root-relative logo', async page => {
    expect(read(page)).not.toContain('<aside id="filtersPanel"');
    const { app, dom, document } = open(page);
    await app.CRONOX_STORE_CATEGORIES.ready;
    expect(document.querySelectorAll('#filtersPanel')).toHaveLength(1);
    const panel = document.getElementById('filtersPanel')!;
    expect(panel.parentElement).toBe(document.body);
    expect(panel.querySelector('img')?.getAttribute('src')).toBe('/favicon.png?v=4');
    expect(panel.querySelector('.filters-close')?.getAttribute('type')).toBe('button');
    expect(panel.querySelectorAll('.black-menu__link')).toHaveLength(2);
    expect(panel.querySelector('.black-menu__discover')?.getAttribute('href')).toBe('/sobre-cronox');
    await new Promise(resolve => setTimeout(resolve, 0));
    dom.window.close();
  });

  it('keeps cart interaction and lock after closing navigation, and releases both after cart closes', async () => {
    const { app, dom, document } = open('producto.html');
    await app.CRONOX_STORE_CATEGORIES.ready;
    const cart = document.getElementById('cart-drawer')!;
    const menu = document.getElementById('filtersPanel')!;
    const trigger = document.getElementById('btnMenu')!;
    trigger.click();
    document.getElementById('cart-icon-btn')!.click();
    expect(menu.inert).toBe(false);
    expect(menu.classList.contains('is-open')).toBe(true);
    expect(cart.inert).toBe(true);
    expect(document.activeElement).toBe(menu.querySelector('.filters-close'));
    document.dispatchEvent(new app.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await finishClosing();
    expect(menu.hidden).toBe(true);
    expect(cart.inert).toBe(false);
    expect(cart.hidden).toBe(false);
    expect(cart.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement?.id).toBe('cart-close-btn');
    expect(document.documentElement.classList.contains('has-scroll-lock')).toBe(true);
    expect(document.getElementById('cart-overlay')!.hidden).toBe(false);
    document.getElementById('cart-close-btn')!.click();
    expect(document.documentElement.classList.contains('has-scroll-lock')).toBe(false);
    expect(document.getElementById('topbar')!.inert).not.toBe(true);
    dom.window.close();
  });

  it('cancels stale close timers on rapid reopening and preserves a separate search lock', async () => {
    const { app, dom, document } = open('index.html');
    await app.CRONOX_STORE_CATEGORIES.ready;
    document.getElementById('btnSearch')!.click();
    const trigger = document.getElementById('btnMenu')!;
    const close = document.querySelector<HTMLButtonElement>('.filters-close')!;
    trigger.click(); close.click(); trigger.click();
    await finishClosing();
    const menu = document.getElementById('filtersPanel')!;
    expect(menu.hidden).toBe(false);
    expect(menu.inert).toBe(false);
    expect(menu.classList.contains('is-open')).toBe(true);
    close.click(); await finishClosing();
    expect(document.documentElement.classList.contains('has-scroll-lock')).toBe(true);
    expect(document.getElementById('overlay')!.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>('.searchbar__close')!.click();
    expect(document.documentElement.classList.contains('has-scroll-lock')).toBe(false);
    dom.window.close();
  });
});
