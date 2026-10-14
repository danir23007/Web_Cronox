import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserNumberingGate } from '../users/user-numbering-gate.module';
import { correosConfig } from './correos.config';
import { CorreosApiError } from './trackpub.client';

/** Session advisory slots bound concurrency across PM2; disconnect releases them. */
@Injectable()
export class TrackingRequestGate {
  constructor(private readonly db: PrismaService, private readonly numbering: UserNumberingGate) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    const client = await this.numbering.pool.connect();
    let slot: number | undefined;
    try {
      for (let index = 0; index < correosConfig().concurrency; index++) {
        const result = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(824032,$1) AS locked', [index]);
        if (result.rows[0]?.locked) { slot = index; break; }
      }
      if (slot === undefined) throw new CorreosApiError('TRACKING_BUSY', 10000);
      const delay = await this.db.$transaction(async tx => {
        await tx.$executeRaw`INSERT INTO "CorreosTrackingGate" (key,"notBefore") VALUES ('REQUESTS',now()) ON CONFLICT (key) DO NOTHING`;
        const [row] = await tx.$queryRaw<{ notBefore: Date }[]>`SELECT "notBefore" FROM "CorreosTrackingGate" WHERE key='REQUESTS' FOR UPDATE`;
        const remaining = row.notBefore.getTime() - Date.now();
        if (remaining > correosConfig().requestSpacingMs) throw new CorreosApiError('RATE_WAIT', remaining);
        const wait = Math.max(0, remaining);
        await tx.correosTrackingGate.update({ where: { key: 'REQUESTS' }, data: { notBefore: new Date(Date.now() + wait + correosConfig().requestSpacingMs) } });
        return wait;
      });
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      return await work();
    } catch (error) {
      if (error instanceof CorreosApiError && error.retryAfterMs > 0 && /HTTP_429|HTTP_503/.test(error.code)) {
        const until = new Date(Date.now() + error.retryAfterMs);
        await this.db.$executeRaw`INSERT INTO "CorreosTrackingGate" (key,"notBefore") VALUES ('REQUESTS',${until}) ON CONFLICT (key) DO UPDATE SET "notBefore"=GREATEST("CorreosTrackingGate"."notBefore",EXCLUDED."notBefore")`;
      }
      throw error;
    } finally {
      if (slot === undefined) client.release();
      else {
        try { await client.query('SELECT pg_advisory_unlock(824032,$1)', [slot]); client.release(); }
        catch { client.release(true); }
      }
    }
  }
}
