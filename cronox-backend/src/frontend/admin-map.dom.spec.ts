import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { PROVINCES, REGIONS } from '../admin/map/spain-geography';

const frontend = join(__dirname, '../../../cronox-front');
const source = readFileSync(join(frontend, 'assets/admin-map.js'), 'utf8');
const svg = readFileSync(
  join(frontend, 'assets/maps/spain-communities.svg'),
  'utf8',
);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const provinceSvg = readFileSync(
  join(frontend, 'assets/maps/spain-provinces.svg'),
  'utf8',
);
const report = (from = '2026-10-01', to = '2026-10-07', orders = 1) => ({
  provinces: PROVINCES.map((p) => ({
    ...p,
    regionName: REGIONS.find((r) => r.id === p.regionId)!.name,
    orders,
    units: orders * 2,
    revenueCents: orders * 100,
  })),
  communityOnly: [],
  regions: REGIONS.map((r) => ({
    ...r,
    orders,
    units: orders * 2,
    revenueCents: orders * 100,
    provinces: [],
  })),
  groups: [],
  identified: {
    orders: orders * 19,
    units: orders * 38,
    revenueCents: orders * 1900,
  },
  total: {
    orders: orders * 19,
    units: orders * 38,
    revenueCents: orders * 1900,
  },
  orders: [],
  exclusions: { refunded: 0, undated: 0 },
  warnings: [],
  basis: 'IVA incluido, envío excluido',
  range: { from, to },
  reconciliation: {
    grossUnits: orders * 38,
    returnedUnits: 0,
    financePeriod: { revenueCents: orders * 1900 },
    revenueDifferenceCents: 0,
  },
  pagination: { page: 1, pages: 1, total: 0 },
});
function setup() {
  const dom = new JSDOM('<div id="adminMap"></div>', {
    runScripts: 'outside-only',
    url: 'https://cronox.test/admin.html#section-map?from=2026-10-01&to=2026-10-07',
  });
  const w = dom.window as any;
  const requests: { url: string; resolve: (v: unknown) => void }[] = [];
  w.fetch = jest.fn((url: string) =>
    url.includes('/assets/maps/')
      ? Promise.resolve({
          ok: true,
          text: async () =>
            url.includes('spain-provinces') ? provinceSvg : svg,
        })
      : new Promise((resolve) => requests.push({ url, resolve })),
  );
  w.eval(source);
  return { dom, w, requests, $: (s: string) => w.document.querySelector(s) };
}
describe('Map frontend synchronization and accessible states', () => {
  it.each(['communities', 'provinces'])('sorts all %s numerically with Spanish ties, zeros and unavailable amounts', async (division) => {
    const { dom, w, requests, $ } = setup();
    w.location.hash += '&division=' + division;
    w.CRONOX_MAP.load();
    const data = report();
    const rows = division === 'provinces' ? data.provinces : data.regions;
    rows.forEach((r, i) => Object.assign(r, { orders: i % 3 === 0 ? 10 : i % 3 === 1 ? 2 : 0, units: i % 3 === 0 ? 2 : i % 3 === 1 ? 10 : 0, revenueCents: i % 3 === 0 ? 1000 : i % 3 === 1 ? 200 : 0 }));
    rows[0].name = 'Álava'; rows[1].name = 'Zaragoza'; rows[2].name = 'Ñora'; rows[3].name = 'Navarra';
    rows[4].revenueCents = null as never; rows[5].revenueCents = null as never;
    data.groups = [{ id: 'unknown', name: 'Desconocida', orders: 999, units: 999, revenueCents: 999 }] as never;
    requests[0].resolve({ ok: true, json: async () => data });
    await flush(); await flush();
    const ids = () => [...w.document.querySelectorAll('.map-regions-table [data-select]')].map((n: any) => n.dataset.select);
    const byName = (a: any, b: any) => a.name.localeCompare(b.name, 'es') || a.id.localeCompare(b.id);
    expect(ids()).toEqual([...rows].sort(byName).map(r => r.id));
    expect($('[data-column="name"]').getAttribute('aria-sort')).toBe('ascending');
    expect($('[data-sort="percent"]')).toBeNull();
    for (const key of ['orders', 'units', 'revenueCents', 'name']) {
      for (const direction of key === 'name' ? [1, -1] : [-1, 1]) {
        $(`[data-sort="${key}"]`).click();
        const expected = [...rows].sort((a: any, b: any) => {
          if (a[key] === null || b[key] === null) return a[key] === b[key] ? byName(a, b) : a[key] === null ? 1 : -1;
          return direction * (key === 'name' ? a.name.localeCompare(b.name, 'es') : a[key] - b[key]) || byName(a, b);
        });
        expect(ids()).toEqual(expected.map(r => r.id));
        expect(ids()).toHaveLength(division === 'provinces' ? 52 : 19);
        expect($(`[data-column="${key}"]`).getAttribute('aria-sort')).toBe(direction === 1 ? 'ascending' : 'descending');
        expect($(`[data-sort="${key}"] .map-sort-indicator`).textContent).toBe(direction === 1 ? '↑' : '↓');
        expect($('.map-exceptions-list').textContent).toContain('Desconocida');
      }
    }
    const selected = ids()[3];
    $(`.map-regions-table [data-select="${selected}"]`).click();
    expect(requests[1].url).toContain('region=' + selected);
    requests[1].resolve({ ok: true, json: async () => data }); await flush();
    expect($('.map-detail h2').textContent).toBe(rows.find(r => r.id === selected)!.name);
    dom.window.close();
  });
  it('retains table sorting across metric, dates and division changes', async () => {
    const { dom, w, requests, $ } = setup();
    w.CRONOX_MAP.load(); requests[0].resolve({ ok: true, json: async () => report() }); await flush();
    $('[data-sort="orders"]').click(); $('[data-sort="orders"]').click();
    for (const metric of ['units', 'revenueCents']) {
      $('[name="metric"]').value = metric; $('[name="metric"]').dispatchEvent(new w.Event('change'));
      expect($('[data-column="orders"]').getAttribute('aria-sort')).toBe('ascending');
    }
    $('[name="from"]').value = '2026-10-02';
    $('.map-filters').dispatchEvent(new w.Event('submit', { cancelable: true }));
    expect(requests[1].url).toContain('from=2026-10-02');
    requests[1].resolve({ ok: true, json: async () => report() }); await flush();
    $('[name="division"]').value = 'provinces'; $('[name="division"]').dispatchEvent(new w.Event('change'));
    requests[2].resolve({ ok: true, json: async () => report() }); await flush();
    expect($('[data-column="orders"]').getAttribute('aria-sort')).toBe('ascending');
    expect($('[data-sort="name"] [data-sort-label]').textContent).toBe('Provincia · Comunidad');
    expect(w.document.querySelectorAll('.map-regions-table tbody tr')).toHaveLength(52);
    dom.window.close();
  });
  it('switches divisions, keeps filters, clears detail and ignores obsolete sales', async () => {
    const { dom, w, requests, $ } = setup();
    w.CRONOX_MAP.load();
    requests[0].resolve({ ok: true, json: async () => report() });
    await flush();
    await flush();
    $('.map-graphic [data-region="13"]').dispatchEvent(
      new w.MouseEvent('click', { bubbles: true }),
    );
    $('[name="metric"]').value = 'units';
    $('[name="metric"]').dispatchEvent(new w.Event('change'));
    $('[name="division"]').value = 'provinces';
    $('[name="division"]').dispatchEvent(new w.Event('change'));
    expect(requests[2].url).toContain('division=provinces');
    expect(requests[2].url).not.toContain('region=');
    requests[2].resolve({ ok: true, json: async () => report() });
    await flush();
    await flush();
    expect(
      w.document.querySelectorAll('.map-graphic [data-region]'),
    ).toHaveLength(52);
    expect(
      w.document.querySelectorAll('.map-regions-table tbody tr'),
    ).toHaveLength(52);
    expect($('[name="from"]').value).toBe('2026-10-01');
    expect($('[name="metric"]').value).toBe('units');
    requests[1].resolve({
      ok: true,
      json: async () => report(undefined, undefined, 99),
    });
    await flush();
    expect($('.map-detail').hidden).toBe(true);
    for (const [id, name, region] of [
      ['07', 'Illes Balears', 'Illes Balears'],
      ['35', 'Las Palmas', 'Canarias'],
      ['38', 'Santa Cruz de Tenerife', 'Canarias'],
      ['51', 'Ceuta', 'Ceuta'],
      ['52', 'Melilla', 'Melilla'],
    ]) {
      $(`.map-graphic [data-region="${id}"]`).focus();
      expect($('.map-tooltip').textContent).toContain(name);
      expect($('.map-tooltip').textContent).toContain(region);
    }
    $('.map-graphic [data-region="35"]').dispatchEvent(
      new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    );
    expect(requests[3].url).toContain('region=35');
    requests[3].resolve({ ok: true, json: async () => report() });
    await flush();
    expect($('.map-detail h2').textContent).toBe('Las Palmas');
    dom.window.close();
  });
  it('ignores delayed obsolete cartography and keeps 52 gray provinces with no sales', async () => {
    const { dom, w, requests, $ } = setup();
    const original = w.fetch.getMockImplementation();
    let release: (v: unknown) => void = () => {};
    w.fetch.mockImplementation((url: string) =>
      url.includes('spain-communities')
        ? new Promise((resolve) => {
            release = resolve;
          })
        : original(url),
    );
    w.CRONOX_MAP.load();
    $('[name="division"]').value = 'provinces';
    $('[name="division"]').dispatchEvent(new w.Event('change'));
    requests[1].resolve({
      ok: true,
      json: async () => report(undefined, undefined, 0),
    });
    await flush();
    await flush();
    release({ ok: true, text: async () => svg });
    requests[0].resolve({ ok: true, json: async () => report() });
    await flush();
    await flush();
    expect(
      w.document.querySelectorAll('.map-graphic [data-region]'),
    ).toHaveLength(52);
    expect(
      [...w.document.querySelectorAll('.map-graphic [data-region]')].every(
        (n: any) => n.style.fill === '#44444d',
      ),
    ).toBe(true);
    expect($('.map-status').textContent).toContain('No hay pedidos');
    dom.window.close();
  });
  it('ignores an older response even when transport ignores abort; reuses the SVG', async () => {
    const { dom, w, requests, $ } = setup();
    w.CRONOX_MAP.load();
    w.location.hash = '#section-map?from=2026-10-02&to=2026-10-03';
    w.CRONOX_MAP.load();
    requests[1].resolve({
      ok: true,
      json: async () => report('2026-10-02', '2026-10-03', 2),
    });
    await flush();
    await flush();
    expect($('.map-cards').textContent).toContain('38');
    requests[0].resolve({ ok: true, json: async () => report() });
    await flush();
    expect($('.map-cards').textContent).toContain('38');
    expect(
      w.fetch.mock.calls.filter(([url]: string[]) =>
        url.includes('/assets/maps/'),
      ),
    ).toHaveLength(1);
    dom.window.close();
  });
  it('keeps equal positive values distinct from zero and exposes ties and keyboard names', async () => {
    const { dom, w, requests, $ } = setup();
    w.CRONOX_MAP.load();
    requests[0].resolve({ ok: true, json: async () => report() });
    await flush();
    await flush();
    expect($('.map-cards').textContent).toContain(
      'Empate entre 19 comunidades',
    );
    expect($('.map-legend').textContent).toContain('0');
    expect($('.map-legend').textContent).toContain('1');
    expect(
      $('.map-graphic [data-region="18"]').getAttribute('aria-label'),
    ).toContain('Ceuta: 1 pedidos');
    expect($('.map-graphic [data-region]').style.fill).not.toBe('#44444d');
    $('.map-graphic [data-region="19"]').focus();
    expect($('.map-tooltip').textContent).toContain('Melilla');
    $('[name="metric"]').value = 'units';
    $('[name="metric"]').dispatchEvent(new w.Event('change'));
    expect(requests).toHaveLength(1);
    expect($('.map-legend').textContent).toContain('Unidades');
    dom.window.close();
  });
  it('shows neutral empty data, then a safe error and retry without stale results', async () => {
    const { dom, w, requests, $ } = setup();
    w.CRONOX_MAP.load();
    requests[0].resolve({
      ok: true,
      json: async () => report('2026-10-01', '2026-10-07', 0),
    });
    await flush();
    await flush();
    expect($('.map-status').textContent).toBe(
      'No hay pedidos pagados en este período',
    );
    expect($('.map-graphic [data-region]').style.fill).toBe('#44444d');
    w.CRONOX_MAP.load();
    requests[1].resolve({ ok: false, status: 500 });
    await flush();
    expect($('.map-results').hidden).toBe(true);
    expect($('.map-cartography').closest('.map-results')).toBeNull();
    expect($('.map-graphic [data-region]')).not.toBeNull();
    expect($('.map-legend').textContent).toContain('Ventas no disponibles');
    expect($('.map-legend').textContent).not.toContain('0');
    $('.map-graphic [data-region="18"]').focus();
    expect($('.map-tooltip').textContent).toContain('Ceuta');
    expect($('.map-tooltip').textContent).toContain('Ventas no disponibles');
    expect($('[data-retry]').hidden).toBe(false);
    $('[data-retry]').click();
    expect(requests).toHaveLength(3);
    requests[2].resolve({ ok: true, json: async () => report() });
    await flush();
    await flush();
    expect($('.map-results').hidden).toBe(false);
    expect($('[data-retry]').hidden).toBe(true);
    dom.window.close();
  });
  it('loads all geographic regions while the sales request is still pending', async () => {
    const { dom, w, $ } = setup();
    w.CRONOX_MAP.load();
    await flush();
    await flush();
    expect(
      w.document.querySelectorAll('.map-graphic [data-region]'),
    ).toHaveLength(19);
    expect($('.map-results').hidden).toBe(true);
    expect($('.map-cartography').closest('[hidden]')).toBeNull();
    expect($('.map-legend').textContent).toContain('Cargando ventas');
    $('.map-graphic [data-region="19"]').focus();
    expect($('.map-tooltip').textContent).toContain('Melilla');
    dom.window.close();
  });
  it('keeps cartography failure separate and retries only its local resource', async () => {
    const { dom, w, requests, $ } = setup();
    const originalFetch = w.fetch.getMockImplementation();
    let attempts = 0;
    w.fetch.mockImplementation((url: string) =>
      url.includes('/assets/maps/') && attempts++ === 0
        ? Promise.resolve({ ok: false, status: 404 })
        : originalFetch(url),
    );
    w.CRONOX_MAP.load();
    requests[0].resolve({ ok: true, json: async () => report() });
    await flush();
    await flush();
    expect($('.map-results').hidden).toBe(false);
    expect($('.map-cartography-status').textContent).toContain('cartografía');
    expect($('[data-map-retry]').hidden).toBe(false);
    $('[data-map-retry]').click();
    await flush();
    await flush();
    expect(
      w.document.querySelectorAll('.map-graphic [data-region]'),
    ).toHaveLength(19);
    expect($('.map-graphic [data-region]').style.fill).not.toBe('#44444d');
    expect(requests).toHaveLength(1);
    dom.window.close();
  });
  it('does not replace cartography with an HTML fallback from a bad resource route', async () => {
    const { dom, w, $ } = setup();
    const originalFetch = w.fetch.getMockImplementation();
    w.fetch.mockImplementation((url: string) =>
      url.includes('/assets/maps/')
        ? Promise.resolve({
            ok: true,
            text: async () => '<html><body>Fallback</body></html>',
          })
        : originalFetch(url),
    );
    w.CRONOX_MAP.load();
    await flush();
    await flush();
    expect($('.map-cartography-status').textContent).toContain('19 unidades');
    expect($('[data-map-retry]').hidden).toBe(false);
    expect($('.map-graphic').textContent).not.toContain('Fallback');
    dom.window.close();
  });
  it('does not turn unknown revenue into zero, a maximum or a misleading percentage', async () => {
    const { dom, w, requests, $ } = setup();
    w.CRONOX_MAP.load();
    const data = report();
    data.regions[0].revenueCents = null as never;
    data.identified.revenueCents = null as never;
    requests[0].resolve({ ok: true, json: async () => data });
    await flush();
    await flush();
    $('[name="metric"]').value = 'revenueCents';
    $('[name="metric"]').dispatchEvent(new w.Event('change'));
    expect($('.map-legend').textContent).toContain('No disponible');
    expect($('.map-cards').textContent).toContain(
      'No disponible: importes incompletos',
    );
    expect($('.map-regions-table tbody').textContent).toContain(
      'No disponible',
    );
    dom.window.close();
  });
});
