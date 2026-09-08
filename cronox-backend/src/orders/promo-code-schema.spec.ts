import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('promo-code single-use database contract', () => {
  const backendRoot = path.resolve(__dirname, '../..');
  const schema = readFileSync(
    path.join(backendRoot, 'prisma/schema.prisma'),
    'utf8',
  );
  const migration = readFileSync(
    path.join(
      backendRoot,
      'prisma/migrations/20260903130000_add_single_use_per_user_promo_codes/migration.sql',
    ),
    'utf8',
  );

  it('defaults existing and new promo codes to reusable per user', () => {
    expect(schema).toMatch(/singleUsePerUser\s+Boolean\s+@default\(false\)/);
    expect(migration).toContain(
      'ADD COLUMN "singleUsePerUser" BOOLEAN NOT NULL DEFAULT false',
    );
  });

  it('retains the database uniqueness barrier for concurrent claims', () => {
    const redemptionModel = schema.slice(
      schema.indexOf('model PromoCodeRedemption'),
      schema.indexOf('model AdminNote'),
    );
    expect(redemptionModel).toContain('@@unique([promoCodeId, userId])');
  });
});
