import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const frontend = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(frontend, file), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const design = { id: 'metacrilatos', renderer: 'metacrilatos-v1', config: { version: 1 } };
const stats = { circleLevel: 5, pedidosRealizados: 9, articulosAdquiridos: 14, productosDiferentes: 4 };
const deferred = () => {
  let resolve!: (value: any) => void;
  let reject!: (value: any) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

describe('METACRILATOS member composition data and instance lifecycle', () => {
  const windows: any[] = [];
  afterEach(() => {
    for (const win of windows.splice(0)) win.close();
  });

  async function setup(circleLevel = 5, getStats = jest.fn().mockResolvedValue(stats)) {
    const dom = new JSDOM(read('profile.html'), {
      url: 'http://localhost/profile.html', runScripts: 'outside-only', virtualConsole: new VirtualConsole(),
    });
    const win = dom.window as any;
    windows.push(win);
    win.eval(readFileSync(path.join(frontend, 'assets/metacrilatos-presentation.js'), 'utf8'));
    const personal = { circleLevel, name: 'Nombre Miembro', visibleId: 'stable-member', createdAt: '2020-01-01', qrDataUrl: 'data:image/png;base64,AA==' };
    const destroys: jest.Mock[] = [];
    const mount = jest.fn((host, data) => {
      host.dataset.crxLevel = String(data.circleLevel);
      const object = win.document.createElement('div');
      object.className = 'crx-object';
      object.style.transform = 'rotateY(73deg)';
      object.textContent = data.name;
      host.append(object);
      const destroy = jest.fn();
      destroys.push(destroy);
      return { destroy, ready: Promise.resolve() };
    });
    const getMyOrders = jest.fn().mockResolvedValue([{ id: 'partial-page-should-not-be-used' }]);
    win.CRONOX_USER = { id: 7, identityUid: 'stable-member', circleLevel: 1, memberCode: 'old-visible-id' };
    win.CRONOX_API = { getAccreditationStats: getStats, getMyOrders };
    win.CRONOX_USER_IDENTITY = { format: () => 'old-visible-id' };
    win.CRONOX_METACRILATOS = { mount };
    win.fetch = jest.fn(async (url: string) => ({ ok: true, json: async () => url.endsWith('/active') ? design : personal }));
    win.eval(read('assets/accreditation-designs.js'));
    win.eval(read('assets/profile.js'));
    await tick();
    const section = win.document.querySelector('[data-profile-section="accreditation"]');
    const panel = win.document.querySelector('[data-metacrilatos-member]');
    const history = panel.querySelector('[data-meta-history]');
    const retry = panel.querySelector('[data-meta-retry]');
    const open = async () => {
      win.document.querySelector('[data-profile-tab="accreditation"]').click();
      await tick();
      await tick();
    };
    const numbers = () => [...panel.querySelectorAll('[data-meta-stat]')].map((node: any) => node.textContent);
    return { win, personal, mount, destroys, getStats, getMyOrders, section, panel, history, retry, open, numbers };
  }

  it.each([1, 2, 3, 4, 5])('uses circle %i from the mounted personal card despite stale browser or statistics circle', async circle => {
    const context = await setup(circle, jest.fn().mockResolvedValue({ ...stats, circleLevel: circle === 5 ? 1 : 5 }));
    const { panel, mount, getMyOrders, open } = context;
    await open();
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('[data-meta-circle]').textContent).toBe(['I', 'II', 'III', 'IV', 'V'][circle - 1]);
    expect(panel.dataset.circleLevel).toBe(String(circle));
    const selected = panel.querySelectorAll('[data-meta-circle-marker][aria-current="true"]');
    expect(selected).toHaveLength(1);
    expect(selected[0].dataset.metaCircleMarker).toBe(String(circle));
    expect(panel.querySelectorAll('[data-meta-circle-marker] button, [data-meta-circle-marker] a')).toHaveLength(0);
    const privileges = panel.querySelector('[data-meta-privileges]').textContent;
    expect(privileges.includes('25% de descuento permanente')).toBe(circle === 5);
    expect(privileges.includes('10% de descuento permanente')).toBe(circle === 4);
    expect(panel.querySelectorAll('[data-meta-privileges] li')).toHaveLength([1, 2, 3, 6, 7][circle - 1]);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0][1].circleLevel).toBe(circle);
    expect(getMyOrders).not.toHaveBeenCalled();
  });

  it('keeps the first presentation loading until totals settle, then reveals real zeroes without remounting', async () => {
    const pending = deferred();
    const { panel, history, section, mount, destroys, open, numbers } = await setup(5, jest.fn(() => pending.promise));
    await open();
    const card = section.querySelector('.crx-object');
    expect(section.classList.contains('is-loading')).toBe(true);
    expect(panel.hidden).toBe(false);
    expect(history.getAttribute('aria-busy')).toBe('true');
    expect(numbers()).toEqual(['—', '—', '—']);
    expect(panel.querySelectorAll('[data-meta-privileges] li')).toHaveLength(7);
    pending.resolve({ circleLevel: 5, pedidosRealizados: 0, articulosAdquiridos: 0, productosDiferentes: 0 });
    await tick();
    expect(section.classList.contains('is-loading')).toBe(false);
    expect(numbers()).toEqual(['0', '0', '0']);
    expect(history.getAttribute('aria-busy')).toBe('false');
    expect(section.querySelector('.crx-object')).toBe(card);
    expect(card.style.transform).toBe('rotateY(73deg)');
    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroys[0]).not.toHaveBeenCalled();
  });

  it('starts fresh totals before design resources and leaves artwork and loader unloaded on the Orders tab', async () => {
    const designReply = deferred();
    const { win, section, mount, getStats, open } = await setup();
    expect(section.querySelector('.accreditation-book-art').hasAttribute('src')).toBe(false);
    expect(win.document.querySelector('link[rel="preload"][href*="Libro-antiguo"]')).toBeNull();
    expect(win.document.getElementById('preloader')).toBeNull();
    const originalFetch = win.fetch;
    win.fetch = jest.fn((url: string) => url.endsWith('/active') ? designReply.promise : originalFetch(url));
    await open();
    expect(getStats).toHaveBeenCalledTimes(1);
    expect(getStats.mock.calls[0][0].signal).toBeDefined();
    expect(mount).not.toHaveBeenCalled();
    expect(section.classList.contains('is-loading')).toBe(true);
    expect(win.document.getElementById('preloader').hidden).toBe(false);
    designReply.resolve({ ok: true, json: async () => design });
    await tick(); await tick();
    expect(mount).toHaveBeenCalledTimes(1);
    expect(section.classList.contains('is-loading')).toBe(false);
    expect(getStats).toHaveBeenCalledTimes(1);
    expect(section.querySelector('.accreditation-book-art').hasAttribute('src')).toBe(false);
  });

  it('reads III eligibility after authoritative totals finish a due promotion, then reveals both results together', async () => {
    const totals = deferred();
    const { win, section, open } = await setup(3, jest.fn(() => totals.promise));
    const upgrade = jest.fn(async () => ({ circleLevel: 3, canRequest: true, hasPending: false, hasApproved: false }));
    win.CRONOX_API.getCircleUpgradeStatus = upgrade;
    await open();
    expect(upgrade).not.toHaveBeenCalled();
    expect(section.classList.contains('is-loading')).toBe(true);
    totals.resolve({ ...stats, circleLevel: 3 });
    await tick(); await tick();
    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(win.CRONOX_USER.circleLevel).toBe(3);
    expect(section.classList.contains('is-loading')).toBe(false);
    expect(win.document.querySelector('[data-circle4-request-btn]').disabled).toBe(false);
  });

  it('revalidates early circle II responses when the personal read crosses promotion time and mounts circle III', async () => {
    const designReply = deferred();
    const getStats = jest.fn().mockResolvedValueOnce({ ...stats, circleLevel: 2 })
      .mockResolvedValueOnce({ ...stats, circleLevel: 3 });
    const { win, section, mount, open } = await setup(3, getStats);
    const upgrade = jest.fn().mockResolvedValueOnce({ circleLevel: 2, canRequest: false, eligibleAt: null })
      .mockResolvedValueOnce({ circleLevel: 3, canRequest: true, hasPending: false, hasApproved: false });
    win.CRONOX_API.getCircleUpgradeStatus = upgrade;
    const originalFetch = win.fetch;
    win.fetch = jest.fn((url: string) => url.endsWith('/active') ? designReply.promise : originalFetch(url));
    await open();
    expect(getStats).toHaveBeenCalledTimes(1);
    expect(upgrade).toHaveBeenCalledTimes(1);
    expect(section.classList.contains('is-loading')).toBe(true);
    designReply.resolve({ ok: true, json: async () => design });
    await tick(); await tick();
    expect(getStats).toHaveBeenCalledTimes(2);
    expect(upgrade).toHaveBeenCalledTimes(2);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(mount.mock.calls[0][1].circleLevel).toBe(3);
    expect(win.CRONOX_ACCREDITATION_STATS.circleLevel).toBe(3);
    expect(win.CRONOX_USER.circleLevel).toBe(3);
    expect(win.document.querySelector('[data-circle4-request-btn]').disabled).toBe(false);
    expect(section.classList.contains('is-loading')).toBe(false);
  });

  it('advances the server countdown from response receipt while artwork is still loading', async () => {
    const ready = deferred();
    const server = Date.parse('2026-10-17T12:00:00Z');
    const { win, mount, section, open } = await setup(2, jest.fn().mockResolvedValue({ ...stats, circleLevel: 2,
      promotion: { canRequest: false, hasPending: false, eligibleAt: new Date(server + 300000).toISOString(), serverTime: new Date(server).toISOString() } }));
    let now = 0;
    win.performance.now = () => now;
    const originalMount = mount.getMockImplementation()!;
    mount.mockImplementation((host, data) => ({ ...originalMount(host, data), ready: ready.promise.then(() => undefined) }));
    await open();
    expect(section.classList.contains('is-loading')).toBe(true);
    now = 120000;
    ready.resolve(undefined);
    await tick(); await tick();
    expect(section.classList.contains('is-loading')).toBe(false);
    expect(win.document.querySelector('[data-circle-request-cooldown]').textContent).toContain('3 minutos');
    expect(win.document.querySelector('[data-circle-request-btn]').disabled).toBe(true);
  });

  it('does not start another eligibility request after leaving during the prefetched totals', async () => {
    const pending = deferred();
    const { win, section, open } = await setup(3, jest.fn(() => pending.promise));
    const upgrade = jest.fn();
    win.CRONOX_API.getCircleUpgradeStatus = upgrade;
    await open();
    win.document.querySelector('[data-profile-tab="account"]').click();
    pending.resolve({ ...stats, circleLevel: 3 });
    await tick(); await tick();
    expect(upgrade).not.toHaveBeenCalled();
    expect(section.classList.contains('is-active')).toBe(false);
  });

  it('offers retry on history failure and updates only totals, preserving the card orientation and instance', async () => {
    const second = deferred();
    const getStats = jest.fn().mockRejectedValueOnce(new Error('Offline')).mockImplementationOnce(() => second.promise);
    const { section, panel, retry, mount, destroys, open, numbers } = await setup(4, getStats);
    await open();
    const card = section.querySelector('.crx-object');
    expect(section.classList.contains('is-loading')).toBe(false);
    expect(panel.hidden).toBe(false);
    expect(retry.hidden).toBe(false);
    expect(numbers()).toEqual(['—', '—', '—']);
    expect(panel.querySelector('[data-meta-status]').textContent).toMatch(/no se pudo|no se pudieron|no pudimos/i);
    retry.click();
    retry.click();
    await tick();
    expect(getStats).toHaveBeenCalledTimes(2);
    second.resolve({ ...stats, circleLevel: 1 });
    await tick();
    expect(numbers()).toEqual(['9', '14', '4']);
    expect(panel.querySelector('[data-meta-circle]').textContent).toBe('IV');
    expect(retry.hidden).toBe(true);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(destroys[0]).not.toHaveBeenCalled();
    expect(section.querySelector('.crx-object')).toBe(card);
    expect(card.style.transform).toBe('rotateY(73deg)');
  });

  it.each([null, {}, { ...stats, pedidosRealizados: null }, { ...stats, articulosAdquiridos: -1 }, { ...stats, productosDiferentes: '2' }])(
    'treats an incomplete or invalid statistics response as unavailable, never as zero: %j', async response => {
      const { panel, retry, open, numbers } = await setup(2, jest.fn().mockResolvedValue(response));
      await open();
      expect(panel.hidden).toBe(false);
      expect(retry.hidden).toBe(false);
      expect(numbers()).toEqual(['—', '—', '—']);
    },
  );

  it('ignores late history after closing and mounts one new instance on reopening', async () => {
    const first = deferred();
    const getStats = jest.fn().mockImplementationOnce(() => first.promise).mockResolvedValueOnce({ ...stats, circleLevel: 3 });
    const { win, panel, destroys, mount, open, numbers } = await setup(3, getStats);
    await open();
    win.document.querySelector('[data-profile-tab="account"]').click();
    await tick();
    expect(panel.hidden).toBe(true);
    expect(destroys[0]).toHaveBeenCalledTimes(1);
    await open();
    expect(panel.hidden).toBe(false);
    expect(numbers()).toEqual(['9', '14', '4']);
    expect(mount).toHaveBeenCalledTimes(2);
    first.resolve({ ...stats, pedidosRealizados: 999 });
    await tick();
    expect(numbers()).toEqual(['9', '14', '4']);
  });

  it('clears member details on identity change and rejects the old request result', async () => {
    const pending = deferred();
    const { win, panel, destroys, open, numbers } = await setup(5, jest.fn(() => pending.promise));
    await open();
    win.CRONOX_USER = { id: 8, identityUid: 'new-member', circleLevel: 1 };
    win.dispatchEvent(new win.CustomEvent('cronox:userChanged', { detail: win.CRONOX_USER }));
    pending.resolve({ ...stats, pedidosRealizados: 999 });
    await tick();
    expect(panel.hidden).toBe(true);
    expect(numbers()).not.toContain('999');
    expect(win.CRONOX_ACCREDITATION_STATS).toBeNull();
    expect(destroys[0]).toHaveBeenCalledTimes(1);
  });

  it('keeps the original book and its existing figures and privileges when that design is active', async () => {
    const { win, panel, section, mount, open } = await setup(5);
    const artwork = section.querySelector('.accreditation-book-art');
    const originalUrl = '/assets/logo_banner.png';
    const original = { id: 'original', renderer: 'original-v1', config: { version: 1, artworkUrl: originalUrl } };
    win.fetch = jest.fn(async () => ({ ok: true, json: async () => original }));
    for (const image of section.querySelectorAll('img')) {
      Object.defineProperty(image, 'complete', { get: () => true });
      Object.defineProperty(image, 'naturalWidth', { get: () => 512 });
    }
    await open();
    expect(mount).not.toHaveBeenCalled();
    expect(panel.hidden).toBe(true);
    expect(section.querySelector('.accreditation-stage').hidden).toBe(false);
    expect(section.querySelector('.crx-accreditation-book').hidden).toBe(false);
    expect(artwork.getAttribute('src')).toBe(originalUrl);
    expect(section.querySelector('[data-acc-stat="orders"]').textContent).toBe('9');
    expect(section.querySelector('[data-acc-stat="items"]').textContent).toBe('14');
    expect(section.querySelector('[data-acc-stat="products"]').textContent).toBe('4');
    expect(section.querySelectorAll('[data-acc-privileges-list] li')).toHaveLength(7);
  });

  it('offers a history error instead of fabricated figures when the existing API is unavailable', async () => {
    const { win, panel, retry, open, numbers } = await setup(2);
    delete win.CRONOX_API.getAccreditationStats;
    await open();
    expect(panel.hidden).toBe(false);
    expect(retry.hidden).toBe(false);
    expect(numbers()).toEqual(['—', '—', '—']);
  });
});
