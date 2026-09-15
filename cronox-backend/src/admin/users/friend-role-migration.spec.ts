import { readFileSync } from 'fs';
import { join } from 'path';

describe('FRIEND role migration safety', () => {
  const backendRoot = join(__dirname, '..', '..', '..');
  const schema = readFileSync(
    join(backendRoot, 'prisma', 'schema.prisma'),
    'utf8',
  );
  const migration = readFileSync(
    join(
      backendRoot,
      'prisma',
      'migrations',
      '20260915100000_canonical_user_roles',
      'migration.sql',
    ),
    'utf8',
  );

  it('defines exactly the four canonical roles and preserves USER as default', () => {
    const roleBody = schema.match(/enum Role\s*{([^}]*)}/)?.[1] ?? '';
    const roles = roleBody.match(/\b[A-Z][A-Z_]*\b/g) ?? [];
    expect(roles).toEqual(['USER', 'FRIEND', 'ADMIN', 'SUPERADMIN']);
    expect(schema).toMatch(/role\s+Role\s+@default\(USER\)/);
  });

  it('maps only legacy Super Admin rows before replacing the PostgreSQL enum', () => {
    expect(migration).toContain('BEGIN;');
    expect(migration).toMatch(
      /UPDATE "User"[\s\S]*"role" = 'SUPERADMIN'[\s\S]*"sessionVersion" = "sessionVersion" \+ 1[\s\S]*WHERE "role"::text = 'SUPER_ADMIN'/,
    );
    expect(migration).toContain(
      `CREATE TYPE "Role_canonical" AS ENUM ('USER', 'FRIEND', 'ADMIN', 'SUPERADMIN')`,
    );
    expect(migration).toContain('DROP TYPE "Role"');
    expect(migration).toContain(
      `ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER'`,
    );
    expect(migration).toContain('COMMIT;');
    expect(migration).not.toMatch(/DELETE\s+FROM/i);
  });
});
