import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const frontend = path.resolve(__dirname, '../../../cronox-front');
const read = (name: string) => readFileSync(path.join(frontend, name), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const serverEpoch = Date.parse('2026-10-17T12:00:00Z');
const iso = (time: number) => new Date(time).toISOString();
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (value: any) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('Accreditation promotion availability and server clock', () => {
  const windows: any[] = [];
  afterEach(() => windows.splice(0).forEach(win => win.close()));

  async function setup({ renderer = 'metacrilatos-v1', circle = 2, remaining = 86460000 } = {}) {
    const dom = new JSDOM(read('profile.html'), {
      url: 'http://localhost/profile.html', runScripts: 'outside-only', pretendToBeVisual: true,
      virtualConsole: new VirtualConsole(),
    });
    const win = dom.window as any;
    windows.push(win);
    let monotonic = 0;
    let serverElapsed = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    let nextTimer = 0;
    win.performance.now = () => monotonic;
    win.setTimeout = (callback: () => void, delay = 0) => {
      const id = ++nextTimer;
      timers.set(id, { at: monotonic + delay, callback });
      return id;
    };
    win.clearTimeout = (id: number) => timers.delete(id);
    const promotion: any = {
      fromCircle: 2, toCircle: 3, hasPending: false, canRequest: remaining <= 0,
      circle2PromotedAt: iso(serverEpoch + remaining - 30 * 86400000),
      eligibleAt: iso(serverEpoch + remaining), blockedReason: remaining > 0 ? 'cooldown' : null,
    };
    const upgrade: any = {
      circleLevel: circle, hasPending: false, hasApproved: false, canRequest: remaining <= 0,
      eligibleAt: iso(serverEpoch + remaining), latestRequest: null,
    };
    const statsResponse = () => ({ circleLevel: circle, pedidosRealizados: 9, articulosAdquiridos: 14,
      productosDiferentes: 4, promotionRequestStatus: promotion.hasPending ? 'pending' : 'none',
      promotion: { ...promotion, serverTime: iso(serverEpoch + serverElapsed) } });
    const getStats = jest.fn(async () => statsResponse());
    const getUpgrade = jest.fn(async () => ({ ...upgrade, serverTime: iso(serverEpoch + serverElapsed) }));
    const request = jest.fn(async () => ({ status: 'pending' }));
    win.CRONOX_USER = { id: 7, identityUid: 'stable-member', circleLevel: circle, firstName: 'Miembro' };
    win.CRONOX_API = { getAccreditationStats: getStats, getCircleUpgradeStatus: getUpgrade, requestCirclePromotion: request };
    win.CRONOX_USER_IDENTITY = { format: () => 'stable-member' };
    const mount = jest.fn((host: any, data: any) => {
      host.dataset.crxLevel = String(data.circleLevel);
      host.innerHTML = '<div class="crx-object" style="transform:rotateY(73deg)"></div>';
      return { destroy: jest.fn(), ready: Promise.resolve() };
    });
    win.CRONOX_METACRILATOS = { mount };
    const artworkUrl = '/assets/logo_banner.png';
    win.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/active')
      ? { id: renderer, renderer, config: { version: 1, artworkUrl } }
      : { circleLevel: circle, name: 'Miembro Prueba', visibleId: 'stable-member', createdAt: '2020-01-01', qrDataUrl: 'data:image/png;base64,AA==' } }));
    for (const image of win.document.querySelectorAll('img')) {
      Object.defineProperty(image, 'complete', { get: () => true });
      Object.defineProperty(image, 'naturalWidth', { get: () => 512 });
    }
    win.eval(read('assets/metacrilatos-presentation.js'));
    win.eval(read('assets/accreditation-designs.js'));
    win.eval(read('assets/profile.js'));
    await tick();
    win.document.querySelector('[data-profile-tab="accreditation"]').click();
    await tick(); await tick();
    const query = (selector: string) => win.document.querySelector(selector);
    const button = query(circle === 3 ? '[data-circle4-request-btn]' : '[data-circle-request-btn]');
    const countdown = query(circle === 3 ? '[data-circle4-cooldown]' : '[data-circle-request-cooldown]');
    const message = query(circle === 3 ? '[data-circle4-status]' : '[data-circle-request-status]');
    const advance = async (ms: number) => {
      monotonic += ms;
      const due = [...timers].filter(([, timer]) => timer.at <= monotonic);
      for (const [id, timer] of due) { timers.delete(id); timer.callback(); }
      await tick(); await tick();
    };
    const serverAdvance = (ms: number) => {
      serverElapsed += ms;
      promotion.canRequest = upgrade.canRequest = serverElapsed >= remaining;
      promotion.blockedReason = promotion.canRequest ? null : 'cooldown';
    };
    return { win, query, button, countdown, message, promotion, upgrade, getStats, getUpgrade,
      request, mount, advance, serverAdvance, statsResponse };
  }

  it.each(['original-v1', 'metacrilatos-v1'])('restores a genuinely disabled II request in %s without moving it into the artwork', async renderer => {
    const { win, query, button, countdown, request } = await setup({ renderer });
    expect(button.textContent).toBe('Solicitar ascenso al círculo III');
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(true);
    expect(button.closest('[data-accreditation-promotions]').hidden).toBe(false);
    expect(button.closest('.accreditation-stage')).toBeNull();
    expect(countdown.textContent).toMatch(/1 día, 0 horas y 1 minuto/);
    button.focus(); button.click();
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(win.document.activeElement).not.toBe(button);
    expect(request).not.toHaveBeenCalled();
    expect(query('[data-circle4-cta]').hidden).toBe(true);
  });

  it('uses a monotonic server countdown, rounds the last minute up, and confirms expiry with the server without a reload', async () => {
    const { win, button, countdown, message, getStats, advance, serverAdvance, statsResponse, query, mount } = await setup({ remaining: 60001 });
    const card = query('.crx-object');
    win.Date.now = () => Date.parse('2099-01-01');
    await advance(250);
    expect(button.disabled).toBe(true);
    expect(countdown.textContent).toMatch(/0 días, 0 horas y 1 minuto/);
    const pending = deferred();
    getStats.mockImplementationOnce(() => pending.promise as any);
    serverAdvance(60001);
    await advance(59751);
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
    expect(countdown.hidden).toBe(true);
    expect(message.textContent).toMatch(/Comprobando/);
    pending.resolve(statsResponse());
    await tick(); await tick();
    expect(button.disabled).toBe(false);
    expect(countdown.textContent).toBe('');
    expect(query('.crx-object')).toBe(card);
    expect(card.style.transform).toBe('rotateY(73deg)');
    expect(mount).toHaveBeenCalledTimes(1);
  });

  it('refreshes after background suspension and protects against rapid duplicate submissions', async () => {
    const { win, button, message, serverAdvance, request, getStats } = await setup({ remaining: 10000 });
    serverAdvance(10000);
    win.dispatchEvent(new win.Event('focus'));
    win.dispatchEvent(new win.Event('pageshow'));
    await tick(); await tick();
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(false);
    const pending = deferred(); request.mockImplementationOnce(() => pending.promise as any);
    button.click(); button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    pending.resolve({ status: 'pending' }); await tick();
    expect(message.textContent).toBe('Solicitud pendiente');
    expect(button.disabled).toBe(true);
  });

  it('rechecks other-tab notifications and never invents a date for a historical II member', async () => {
    const { win, button, promotion, message, countdown, getStats } = await setup();
    promotion.eligibleAt = null;
    promotion.circle2PromotedAt = null;
    promotion.blockedReason = 'promotion_date_unknown';
    win.dispatchEvent(new win.StorageEvent('storage', { key: 'cronox_circle_request_updated', newValue: JSON.stringify({ userId: 7 }) }));
    await tick(); await tick();
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(button.disabled).toBe(true);
    expect(countdown.hidden).toBe(true);
    expect(message.textContent).toMatch(/fecha.*pendiente de revisión/);
  });

  it('restores authoritative pending state after a rejected second-tab request', async () => {
    const { button, promotion, request, message } = await setup({ remaining: 0 });
    promotion.hasPending = true; promotion.canRequest = false;
    request.mockRejectedValueOnce(new Error('Ya existe una solicitud pendiente'));
    button.click(); await tick(); await tick();
    expect(button.disabled).toBe(true);
    expect(message.textContent).toBe('Solicitud pendiente');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps failed availability disabled and offers a successful retry', async () => {
    const { win, button, getStats, query } = await setup({ remaining: 0 });
    getStats.mockRejectedValueOnce(new Error('offline'));
    win.dispatchEvent(new win.Event('focus')); await tick(); await tick();
    expect(button.disabled).toBe(true);
    expect(query('[data-promotion-retry]').hidden).toBe(false);
    query('[data-promotion-retry]').click(); await tick(); await tick();
    expect(button.disabled).toBe(false);
    expect(query('[data-promotion-retry]').hidden).toBe(true);
  });

  it('reuses the countdown for III to IV and opens the existing application only once eligible', async () => {
    const { win, button, countdown, serverAdvance, advance, query, upgrade } = await setup({ circle: 3, remaining: 500 });
    expect(button.disabled).toBe(true);
    expect(countdown.textContent).toMatch(/1 minuto/);
    button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    expect(query('#circleUpgradeModal').hidden).toBe(true);
    serverAdvance(500); await advance(500);
    expect(button.disabled).toBe(false);
    button.click();
    expect(query('#circleUpgradeModal').hidden).toBe(false);
    upgrade.hasApproved = true;
    win.dispatchEvent(new win.Event('focus')); await tick(); await tick();
    expect(query('[data-circle4-cta]').hidden).toBe(true);
  });
});
