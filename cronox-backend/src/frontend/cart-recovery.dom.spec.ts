import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const source = readFileSync(path.resolve(__dirname, '../../../cronox-front/assets/cart-recovery.js'), 'utf8');
const episode = '12345678-1234-1234-1234-123456789abc';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('cart recovery browser flow', () => {
  const windows: JSDOM[] = [];
  afterEach(() => { for (const dom of windows.splice(0)) dom.window.close(); });
  const setup = (query = '?recover=' + episode, authenticated = false, pathname = '/cesta') => {
    const dom = new JSDOM('<div id="cartItems"></div>', { url: 'https://example.test' + pathname + query, runScripts: 'outside-only', pretendToBeVisual: true });
    windows.push(dom); const win = dom.window as any;
    win.CRONOX_AUTH_STATE = authenticated ? 'authenticated' : 'anonymous';
    win.CRONOX_USER = authenticated ? { id: 1, role: 'USER' } : null;
    win.CRONOX_openAuthModal = jest.fn();
    win.CRONOX_API = { API_BASE: '', getCsrfHeaders: jest.fn().mockResolvedValue({ 'X-CSRF-Token': 'fixture' }) };
    win.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true }) });
    win.CRONOX_CART = { fetchCart: jest.fn() };
    return win;
  };
  it('preserves destination during same-page login and performs owner-checked recovery afterward', async () => {
    const win = setup(); win.eval(source); await flush();
    expect(win.fetch).not.toHaveBeenCalled(); expect(win.CRONOX_openAuthModal).toHaveBeenCalledWith('login');
    expect(win.sessionStorage.getItem('cronox.cart.recovery')).toContain(episode);
    win.CRONOX_USER = { id: 1, role: 'USER' }; win.CRONOX_AUTH_STATE = 'authenticated';
    win.dispatchEvent(new win.Event('cronox:authResolved')); await flush();
    expect(win.fetch).toHaveBeenCalledWith('/api/cart/recover/' + episode, expect.objectContaining({ method: 'POST', credentials: 'include', cache: 'no-store' }));
    expect(win.location.search).toBe(''); expect(win.sessionStorage.getItem('cronox.cart.recovery')).toBeNull();
    expect(win.CRONOX_CART.fetchCart).toHaveBeenCalledTimes(1);
    win.dispatchEvent(new win.Event('cronox:authResolved')); await flush(); expect(win.fetch).toHaveBeenCalledTimes(1);
  });
  it('shows a generic expired/wrong-account result and retains the current cart', async () => {
    const win = setup(undefined, true);
    win.fetch.mockResolvedValue({ ok: true, json: async () => ({ valid: false }) });
    win.eval(source); await flush();
    expect(win.document.getElementById('cartRecoveryStatus').textContent).toContain('esta cuenta');
    expect(win.CRONOX_CART.fetchCart).toHaveBeenCalledTimes(1);
  });
  it('records one explicit cart visit and ignores repeated authentication refreshes', async () => {
    const win = setup('', true); win.eval(source); await flush();
    win.dispatchEvent(new win.Event('cronox:authResolved')); await flush();
    expect(win.fetch).toHaveBeenCalledTimes(1); expect(win.fetch.mock.calls[0][0]).toBe('/api/cart/activity');
  });
  it.each(['/cesta', '/cart.html'])('recovers on the canonical or legacy cart route %s', async pathname => {
    const win = setup(undefined, true, pathname); win.eval(source); await flush();
    expect(win.fetch.mock.calls[0][0]).toBe('/api/cart/recover/' + episode);
    expect(win.CRONOX_CART.fetchCart).toHaveBeenCalledTimes(1);
  });
  it('does not record hidden pages, anonymous visitors or administrators', async () => {
    const hidden = setup('', true); Object.defineProperty(hidden.document, 'visibilityState', { value: 'hidden' });
    hidden.eval(source); await flush(); expect(hidden.fetch).not.toHaveBeenCalled();
    const anonymous = setup(''); anonymous.eval(source); await flush(); expect(anonymous.fetch).not.toHaveBeenCalled();
    const admin = setup('', true); admin.CRONOX_USER.role = 'ADMIN'; admin.eval(source); await flush(); expect(admin.fetch).not.toHaveBeenCalled();
  });
  it('rejects arbitrary redirect values and keeps failed recoveries available for retry', async () => {
    const win = setup(undefined, true); win.fetch.mockRejectedValueOnce(Error('offline'));
    win.eval(source); await flush(); expect(win.location.search).toContain(episode);
    expect(win.sessionStorage.getItem('cronox.cart.recovery')).toContain(episode);
    win.dispatchEvent(new win.Event('cronox:authResolved')); await flush(); expect(win.fetch).toHaveBeenCalledTimes(2);
    const other = setup('?recover=https://attacker.test', true); other.eval(source); await flush();
    expect(other.fetch.mock.calls[0][0]).toBe('/api/cart/activity');
  });
});
