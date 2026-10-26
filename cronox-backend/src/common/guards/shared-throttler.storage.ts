import type { ThrottlerStorage } from '@nestjs/throttler';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Atomic fixed windows shared by every backend using the same database. */
export class SharedThrottlerStorage implements ThrottlerStorage {
  private sweptAt = 0;
  private readonly logger = new Logger(SharedThrottlerStorage.name);
  constructor(private readonly prisma: PrismaService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    _name: string,
  ) {
    const [row] = await this.prisma.$queryRaw<
      { hits: number; expires: number; blocked: number }[]
    >`
      INSERT INTO "RequestRateWindow" (key, hits, "resetsAt", "blockedUntil")
      VALUES (${key}, 1, statement_timestamp() + ${ttl} * interval '1 millisecond', NULL)
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE
          WHEN "RequestRateWindow"."blockedUntil" > statement_timestamp() THEN "RequestRateWindow".hits
          WHEN "RequestRateWindow"."resetsAt" <= statement_timestamp() OR "RequestRateWindow"."blockedUntil" <= statement_timestamp() THEN 1
          ELSE "RequestRateWindow".hits + 1 END,
        "resetsAt" = CASE
          WHEN "RequestRateWindow"."blockedUntil" > statement_timestamp() THEN "RequestRateWindow"."resetsAt"
          WHEN "RequestRateWindow"."resetsAt" <= statement_timestamp() OR "RequestRateWindow"."blockedUntil" <= statement_timestamp()
            THEN statement_timestamp() + ${ttl} * interval '1 millisecond'
          ELSE "RequestRateWindow"."resetsAt" END,
        "blockedUntil" = CASE
          WHEN "RequestRateWindow"."blockedUntil" > statement_timestamp() THEN "RequestRateWindow"."blockedUntil"
          WHEN "RequestRateWindow"."resetsAt" <= statement_timestamp() OR "RequestRateWindow"."blockedUntil" <= statement_timestamp() THEN NULL
          WHEN "RequestRateWindow".hits + 1 > ${limit} THEN statement_timestamp() + ${blockDuration} * interval '1 millisecond'
          ELSE NULL END
      RETURNING hits, GREATEST(0, CEIL(EXTRACT(EPOCH FROM ("resetsAt" - statement_timestamp()))))::int AS expires,
        GREATEST(0, CEIL(EXTRACT(EPOCH FROM ("blockedUntil" - statement_timestamp()))))::int AS blocked`;
    if (Date.now() - this.sweptAt >= 60_000) {
      this.sweptAt = Date.now();
      // Bounded lifetime, no email/IP/token values in storage or diagnostics.
      void this.prisma
        .$executeRaw`DELETE FROM "RequestRateWindow" WHERE "resetsAt" <= statement_timestamp()
        AND ("blockedUntil" IS NULL OR "blockedUntil" <= statement_timestamp())`.catch(
        () => this.logger.warn('RATE_LIMIT_CLEANUP_DEFERRED'),
      );
    }
    return {
      totalHits: row.hits,
      timeToExpire: row.expires,
      isBlocked: row.blocked > 0,
      timeToBlockExpire: row.blocked,
    };
  }

  // Other instances still need their counters when this one shuts down.
  onApplicationShutdown() {}
}
