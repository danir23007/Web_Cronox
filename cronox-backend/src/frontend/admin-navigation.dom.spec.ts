import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
const root = path.resolve(__dirname, '../../../cronox-front');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

describe('shared administrator navigation', () => {
  const destinations = ['section-dashboard', 'section-products', 'section-product-categories', 'section-inventory', 'section-waitlist', 'section-favorites', 'section-codes',
    'section-money', 'section-map', 'section-gallery-mosaic', 'section-gallery-carousel', 'section-media', 'section-key-screen', 'section-accreditations', 'section-newsletter',
    'section-sale-points', 'section-users', 'section-qr-events', 'section-circles-menu', 'section-orders', 'section-mails', 'section-inbox', 'section-mail-campaign', 'section-push', 'section-activity', 'section-footer'];
  it.each(['admin.html', 'admin-user.html', 'admin-launch.html'])('renders identical ordered links once in %s, before handlers initialize', page => {
    const html = read(page), dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/' + page });
    dom.window.eval(read('assets/admin-navigation.js'));
    const w = dom.window as any;
    w.CRONOX_ADMIN_NAVIGATION.render();
    expect([...w.document.querySelectorAll('[data-admin-navigation] [data-nav-target]')].map((button: any) => button.dataset.navTarget)).toEqual(destinations);
    expect(w.document.querySelectorAll('#navCliente [data-nav-target="section-sale-points"]')).toHaveLength(1);
    expect(w.document.querySelectorAll('#navCliente [data-nav-target="section-qr-events"]')).toHaveLength(1);
    expect(html.indexOf('admin-navigation.js')).toBeLessThan(html.indexOf('admin-shell.js'));
    for (const role of ['ADMIN', 'SUPERADMIN']) {
      w.CRONOX_ADMIN_NAVIGATION.applyRole(role);
      expect(w.document.querySelector('[data-nav-target="section-sale-points"]').hidden).toBe(false);
      expect(w.document.querySelector('[data-nav-target="section-qr-events"]').hidden).toBe(false);
    }
    for (const role of ['USER', 'FRIEND', '', 'unknown']) {
      w.CRONOX_ADMIN_NAVIGATION.applyRole(role);
      expect(w.document.querySelector('[data-nav-target="section-sale-points"]').hidden).toBe(true);
      expect(w.document.querySelector('[data-nav-target="section-qr-events"]').hidden).toBe(true);
    }
    dom.window.close();
  });
});
