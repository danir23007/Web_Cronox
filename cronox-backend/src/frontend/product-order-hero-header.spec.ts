import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

describe('product order, hero text and topbar release contract', () => {
  const root = resolve(__dirname, '../../..');
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

  it('ships a forward-only deterministic migration after prior migrations', () => {
    const migrations = readdirSync(
      resolve(root, 'cronox-backend/prisma/migrations'),
    ).sort();
    const name = '20260917140000_product_order_and_hero_text';
    expect(migrations.indexOf(name)).toBeGreaterThan(
      migrations.indexOf('20260917130000_sliding_auth_sessions'),
    );
    const sql = read(`cronox-backend/prisma/migrations/${name}/migration.sql`);
    expect(sql).toContain('ROW_NUMBER() OVER (ORDER BY id ASC)');
    expect(sql).toContain('ALTER COLUMN "displayOrder" SET NOT NULL');
    expect(sql).toContain('"heroTextEnabled" BOOLEAN NOT NULL DEFAULT false');
    expect(sql).not.toMatch(/DELETE\s+FROM|TRUNCATE/i);
  });

  it('has an accessible complete-order admin surface and no legacy hero copy', () => {
    const admin = read('cronox-front/admin.html');
    const home = read('cronox-front/index.html');
    const order = read('cronox-front/assets/admin-product-order.js');
    expect(admin).toContain('id="productOrderList"');
    expect(admin).toContain('id="productOrderSave"');
    expect(order).toContain('row.draggable');
    expect(order).toContain('aria-label');
    expect(`${admin}\n${home}`).not.toMatch(/NOS REGIT NOX/i);
  });

  it('uses one topbar state source and restores black-at-top/white-after-scroll', () => {
    const css = read('cronox-front/assets/store.css');
    const app = read('cronox-front/assets/app.js');
    expect(css).toMatch(/\.topbar--transparent\{color:#000;/);
    expect(css).toContain(
      '.topbar--transparent .topbar__logo-img{filter:brightness(0);}',
    );
    expect(css).toMatch(/\.topbar--hero,\.topbar--page[^{]*\{color:#fff;/);
    expect(css).toContain(
      'transition:stroke .2s ease,fill .2s ease,color .2s ease,opacity .2s ease,transform .2s ease;',
    );
    expect(css).not.toContain('transition:all .3s ease');
    expect(app).toContain(
      "if (atTop && rect.top >= 0) applyTopbarState('topbar--transparent')",
    );
    expect(app).toContain(
      "else if (rect.bottom > 0)   applyTopbarState('topbar--hero')",
    );
    expect(app).toContain(
      "window.addEventListener('scroll', updateTopbarOnScroll",
    );
  });
});
