import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { runtimeDatabaseUrl } from '../prisma/runtime-database-url';

@Injectable()
export class UserNumberingGate implements OnModuleDestroy {
  private locks?: Pool;
  get pool(): Pool {
    if (!this.locks) {
      const connectionString = runtimeDatabaseUrl(process.env.USER_NUMBERING_DATABASE_URL || process.env.DATABASE_URL);
      if (!connectionString) throw Error('Database URL required for identity gate');
      const url = new URL(connectionString);
      if (url.hostname.endsWith('.pooler.supabase.com') && url.port === '6543') {
        throw Error('Identity gate requires a direct or session-mode PostgreSQL connection');
      }
      this.locks = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000, allowExitOnIdle: true });
      this.locks.on('error', () => { /* Failed idle connections are discarded by pg. */ });
    }
    return this.locks;
  }
  async shared<T>(work: () => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock_shared(824031,1)');
      return await work();
    } finally {
      try { await client.query('SELECT pg_advisory_unlock_shared(824031,1)'); client.release(); }
      catch { client.release(true); }
    }
  }
  async onModuleDestroy() { await this.locks?.end(); }
}

@Global()
@Module({ providers: [UserNumberingGate], exports: [UserNumberingGate] })
export class UserNumberingGateModule {}
