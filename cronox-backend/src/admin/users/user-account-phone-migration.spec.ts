import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

describe('User account phone migration safety', () => {
  const migrationsRoot = join(process.cwd(), 'prisma', 'migrations');
  const columnMigration = readFileSync(
    join(
      migrationsRoot,
      '20260915110000_add_user_account_phone',
      'migration.sql',
    ),
    'utf8',
  );
  const backfillMigration = readFileSync(
    join(
      migrationsRoot,
      '20260915120000_backfill_user_account_phone',
      'migration.sql',
    ),
    'utf8',
  );

  it('adds one nullable account-phone column without rewriting existing data', () => {
    expect(columnMigration).toContain(
      'ALTER TABLE "User" ADD COLUMN "phone" TEXT;',
    );
    expect(columnMigration).not.toMatch(/NOT NULL|DEFAULT|UPDATE\s+"User"/i);
  });

  it('does not copy, delete or update delivery-address data', () => {
    expect(columnMigration).not.toMatch(
      /ALTER TABLE "Address"|UPDATE\s+"Address"|DELETE/i,
    );
    expect(backfillMigration).not.toMatch(
      /UPDATE\s+"Address"|DELETE\s+FROM\s+"Address"|INSERT\s+INTO\s+"Address"/i,
    );
  });

  it('updates only null account phones from a non-empty default-address phone', () => {
    expect(backfillMigration).toContain('WHERE "isDefault" = TRUE');
    expect(backfillMigration).toContain('"phone" IS NOT NULL');
    expect(backfillMigration).toContain('BTRIM("phone") <>');
    expect(backfillMigration).toContain('"user"."phone" IS NULL');
    expect(backfillMigration).toContain(
      'SET "phone" = "selectedDefaultPhones"."phone"',
    );
  });

  it('uses a deterministic default and never falls back to an arbitrary address', () => {
    expect(backfillMigration).toContain('PARTITION BY "userId"');
    expect(backfillMigration).toContain('ORDER BY "updatedAt" DESC, "id" DESC');
    expect(backfillMigration).toContain('"defaultRank" = 1');
  });

  it('models the intended three-migration flow without overwrites or address mutation', () => {
    type FixtureUser = { id: number; phone?: string | null };
    type FixtureAddress = {
      id: number;
      userId: number;
      phone: string | null;
      isDefault: boolean;
      updatedAt: string;
    };
    const users: FixtureUser[] = [
      { id: 1 },
      { id: 2, phone: '+34999999999' },
      { id: 3 },
      { id: 4 },
      { id: 5 },
      { id: 6 },
    ];
    const addresses: FixtureAddress[] = [
      {
        id: 10,
        userId: 1,
        phone: '+34 600 000 001',
        isDefault: true,
        updatedAt: '2026-01-01',
      },
      {
        id: 20,
        userId: 2,
        phone: '+34 600 000 002',
        isDefault: true,
        updatedAt: '2026-01-01',
      },
      {
        id: 30,
        userId: 3,
        phone: '+34 600 000 003',
        isDefault: false,
        updatedAt: '2026-01-01',
      },
      {
        id: 40,
        userId: 4,
        phone: '   ',
        isDefault: true,
        updatedAt: '2026-01-01',
      },
      {
        id: 50,
        userId: 5,
        phone: '+34 600 000 005',
        isDefault: true,
        updatedAt: '2026-01-01',
      },
      {
        id: 51,
        userId: 5,
        phone: null,
        isDefault: true,
        updatedAt: '2026-02-01',
      },
      {
        id: 60,
        userId: 6,
        phone: '+34 600 000 060',
        isDefault: true,
        updatedAt: '2026-01-01',
      },
      {
        id: 61,
        userId: 6,
        phone: '+34 600 000 061',
        isDefault: true,
        updatedAt: '2026-01-01',
      },
    ];
    const originalAddresses = structuredClone(addresses);

    // Migration 110000 adds nullable User.phone; migration 120000 ranks all
    // defaults before validating the selected row, matching the SQL CTE.
    const migratedUsers = users.map((user) => {
      const withColumn = { ...user, phone: user.phone ?? null };
      if (withColumn.phone !== null) return withColumn;
      const selected = addresses
        .filter((address) => address.userId === user.id && address.isDefault)
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) || right.id - left.id,
        )[0];
      return selected?.phone?.trim()
        ? { ...withColumn, phone: selected.phone }
        : withColumn;
    });

    expect(migratedUsers).toEqual([
      { id: 1, phone: '+34 600 000 001' },
      { id: 2, phone: '+34999999999' },
      { id: 3, phone: null },
      { id: 4, phone: null },
      { id: 5, phone: null },
      { id: 6, phone: '+34 600 000 061' },
    ]);
    expect(addresses).toEqual(originalAddresses);
    expect(addresses).toHaveLength(8);
  });

  it('orders canonical roles, account-phone column and compatibility backfill', () => {
    const relevantMigrations = readdirSync(migrationsRoot)
      .filter((name) => name.startsWith('202609151'))
      .sort();

    expect(relevantMigrations).toEqual([
      '20260915100000_canonical_user_roles',
      '20260915110000_add_user_account_phone',
      '20260915120000_backfill_user_account_phone',
    ]);
  });
});
