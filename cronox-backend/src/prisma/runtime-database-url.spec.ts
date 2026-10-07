import { runtimeDatabaseUrl } from './runtime-database-url';

describe('Prisma session-pool runtime URL', () => {
  const session = 'postgresql://fixture:p%40ss@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?pgbouncer=true&connection_limit=1&sslmode=require&pool_timeout=10';
  it('removes only transaction compatibility on verified session endpoints', () => {
    const before = new URL(session), after = new URL(runtimeDatabaseUrl(session)!);
    expect(after.searchParams.has('pgbouncer')).toBe(false);
    before.searchParams.delete('pgbouncer');
    expect(after.toString()).toBe(before.toString());
    expect(after.searchParams.get('connection_limit')).toBe('1');
  });
  it.each([
    session.replace(':5432/', ':6543/'),
    session.replace('aws-1-eu-west-1.pooler.supabase.com', 'db.example.test'),
    session.replace('aws-1-eu-west-1.pooler.supabase.com', 'aws-1-eu-west-1.pooler.supabase.com.example.test'),
    session.replace('pgbouncer=true', 'pgbouncer=false'),
    session.replace('pgbouncer=true&', ''),
    session.replace(':5432/', '/'),
    'postgresql://fixture:fixture@127.0.0.1:5433/cronox_dev',
    'invalid', undefined,
  ])('preserves other modes and configuration: %s', (value) => {
    expect(runtimeDatabaseUrl(value)).toBe(value);
  });
});
