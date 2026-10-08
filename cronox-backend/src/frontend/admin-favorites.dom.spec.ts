import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
const front = join(__dirname, '../../../cronox-front');
const source = readFileSync(join(front, 'assets/admin-favorites.js'), 'utf8');
const html = readFileSync(join(front, 'admin.html'), 'utf8');
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
describe('Admin favorites current query and unavailable state', () => {
  it('ignores responses from superseded filters and never shows an error as zero', async () => {
    const dom = new JSDOM(html, {
        runScripts: 'outside-only',
        url: 'https://cronox.test/admin.html',
      }),
      w = dom.window as any;
    const requests: { resolve: (v: unknown) => void }[] = [];
    w.fetch = jest.fn(
      () => new Promise((resolve) => requests.push({ resolve })),
    );
    w.eval(source);
    w.CRONOX_FAVORITES_ADMIN.load();
    w.CRONOX_FAVORITES_ADMIN.load();
    const report = {
      rows: [],
      summary: { favorites: 5, users: 3 },
      total: 0,
      page: 1,
      pageSize: 25,
    };
    requests[1].resolve({ ok: true, json: async () => report });
    await flush();
    requests[0].resolve({
      ok: true,
      json: async () => ({ ...report, summary: { favorites: 99, users: 99 } }),
    });
    await flush();
    expect(w.document.querySelector('#favoritesSummary').textContent).toContain(
      '5 favoritos',
    );
    expect(
      w.document.querySelector('#favoritesSummary').textContent,
    ).not.toContain('99');
    w.CRONOX_FAVORITES_ADMIN.load();
    requests[2].resolve({ ok: false, status: 503 });
    await flush();
    expect(w.document.querySelector('#favoritesSummary').textContent).toBe(
      'Resumen no disponible.',
    );
    expect(w.document.querySelector('#favoritesRefresh').textContent).toBe(
      'Reintentar',
    );
    expect(w.document.querySelector('#favoritesNext').disabled).toBe(true);
    dom.window.close();
  });
});
