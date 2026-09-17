import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

describe('responsive hero text migration', () => {
  const migrationsRoot = path.resolve(__dirname, '../../prisma/migrations');
  const migrationName = '20260918100000_responsive_hero_text_viewports';
  const sql = readFileSync(
    path.join(migrationsRoot, migrationName, 'migration.sql'),
    'utf8',
  );

  it('is forward-only and follows the original hero-text migration', () => {
    const migrations = readdirSync(migrationsRoot).sort();
    expect(migrations.indexOf(migrationName)).toBeGreaterThan(
      migrations.indexOf('20260917140000_product_order_and_hero_text'),
    );
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  });

  it('seeds tablet from desktop and preserves existing mobile overrides', () => {
    expect(sql).toContain('"heroTextTabletX" = "heroTextX"');
    expect(sql).toContain('"heroTextTabletAlign" = "heroTextAlign"');
    expect(sql).toContain(
      '"heroTextMobileX" = COALESCE("heroTextMobileX", "heroTextX")',
    );
    expect(sql).toContain(
      '"heroTextMobileFontSize" = COALESCE("heroTextMobileFontSize", 30)',
    );
  });
});
