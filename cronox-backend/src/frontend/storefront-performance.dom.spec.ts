import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('storefront initial rendering and shared reads', () => {
  it.each([
    'index.html',
    'producto.html',
    'cart.html',
    'checkout.html',
    'favorites.html',
    'profile.html',
    'checkout-success.html',
    'forgot-password.html',
    'reset-password.html',
  ])(
    'makes the primary stylesheet discoverable without executing JavaScript in %s',
    (file) => {
      const dom = new JSDOM(read(file), { url: 'https://cronox.test/' });
      const link =
        dom.window.document.querySelector<HTMLLinkElement>(
          '#cronox-main-style',
        )!;
      expect(new URL(link.href).pathname).toBe('/assets/store.css');
      expect(link.rel).toBe('stylesheet');
      dom.window.close();
    },
  );

  const setupApi = () => {
    const dom = new JSDOM('<!doctype html><body></body>', {
      url: 'https://cronox.test/',
      runScripts: 'outside-only',
    });
    const fetchMock = jest.fn();
    Object.assign(dom.window, { fetch: fetchMock, Response, Request, Headers });
    dom.window.eval(read('assets/api.js'));
    return { dom, fetchMock, api: (dom.window as any).CRONOX_API };
  };

  it('shares simultaneous user reads but fetches again after settlement', async () => {
    const { dom, fetchMock, api } = setupApi();
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const reads = [api.getMe(), api.getMe(), api.getMe()];
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve(new Response(JSON.stringify({ id: 1 })));
    expect(await Promise.all(reads)).toEqual([{ id: 1 }, { id: 1 }, { id: 1 }]);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 2 })));
    expect(await api.getMe()).toEqual({ id: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    dom.window.close();
  });

  it('does not reuse a pending read after the session ends', async () => {
    const { dom, fetchMock, api } = setupApi();
    let resolve!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const old = api.getMe();
    dom.window.dispatchEvent(new dom.window.Event('cronox:session-ended'));
    fetchMock.mockResolvedValueOnce(new Response('null'));
    expect(await api.getMe()).toBeNull();
    resolve(new Response(JSON.stringify({ id: 1 })));
    await old;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    dom.window.close();
  });

  it('uses the initial cart read for the badge without sending another request', async () => {
    const dom = new JSDOM('<span class="cart-count"></span>', {
      url: 'https://cronox.test/',
      runScripts: 'outside-only',
    });
    await new Promise<void>((resolve) =>
      dom.window.addEventListener('load', () => resolve(), { once: true }),
    );
    const getCart = jest.fn();
    Object.assign(dom.window, {
      CRONOX_API: { getCart },
      CRONOX_CART_READY: Promise.resolve({ itemsCount: 3 }),
    });
    dom.window.eval(read('assets/cart-badge.js'));
    dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getCart).not.toHaveBeenCalled();
    expect(dom.window.document.querySelector('.cart-count')?.textContent).toBe(
      '3',
    );
    dom.window.close();
  });
});
