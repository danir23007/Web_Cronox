import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

describe('sliding auth session migration', () => {
  const migrations = path.resolve(__dirname, '../../prisma/migrations');
  const name = '20260917130000_sliding_auth_sessions';
  const sql = readFileSync(
    path.join(migrations, name, 'migration.sql'),
    'utf8',
  );

  it('is forward-only, ordered after prior migrations, and changes no user data', () => {
    const ordered = readdirSync(migrations)
      .filter((entry: string) => /^\d/.test(entry))
      .sort();
    expect(ordered.at(-1)).toBe(name);
    expect(sql).toContain('CREATE TABLE "AuthSession"');
    expect(sql).toContain('ON DELETE CASCADE');
    expect(sql).not.toMatch(/UPDATE\s+"?User"?/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+"?User"?/i);
    expect(sql).not.toMatch(/CREATE\s+TABLE\s+"Address"/i);
  });
});
