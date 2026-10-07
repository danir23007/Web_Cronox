/**
 * Supavisor's shared session endpoint (5432) supports prepared statements.
 * Prisma's transaction-pool compatibility flag otherwise adds BEGIN,
 * DEALLOCATE ALL and COMMIT and disables the statement cache on every read.
 * Keep transaction pooling (6543), other providers and all pool limits intact.
 * https://supabase.com/docs/guides/troubleshooting/disabling-prepared-statements-qL8lEL
 */
export function runtimeDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    // Environment validation is responsible for reporting invalid configuration.
    return value;
  }
  if (
    ['postgres:', 'postgresql:'].includes(url.protocol) &&
    /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) &&
    url.port === '5432' &&
    url.searchParams.get('pgbouncer') === 'true'
  ) {
    url.searchParams.delete('pgbouncer');
    return url.toString();
  }
  return value;
}
