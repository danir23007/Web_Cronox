import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class MailboxLeasesService {
  private waiting = 0;
  private readonly waitingBoxes = new Map<string, number>();
  hasWaiting(id: string) {
    return this.waitingBoxes.has(id);
  }
  constructor(private readonly db: PrismaService) {}
  interactive<T>(
    id: string,
    operation: (token: string, assert: () => Promise<void>) => Promise<T>,
  ) {
    return this.run(id, operation, { waitMs: 30000 });
  }
  async commit<T>(
    id: string,
    token: string,
    operation: (tx: any) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        const fenced =
          await tx.$executeRaw`UPDATE "Mailbox" SET "leaseUntil"=CURRENT_TIMESTAMP + INTERVAL '120 seconds' WHERE id=${id} AND "leaseToken"=${token} AND "leaseUntil">CURRENT_TIMESTAMP`;
        if (!fenced) throw new ConflictException('MAILBOX_LEASE_LOST');
        return operation(tx);
      },
      { timeout: 60000 },
    );
  }
  async run<T>(
    id: string,
    operation: (token: string, assert: () => Promise<void>) => Promise<T>,
    options: { waitMs?: number } = {},
  ): Promise<T> {
    const token = randomUUID();
    const deadline = Date.now() + (options.waitMs || 0);
    if (options.waitMs) {
      this.waiting++;
      this.waitingBoxes.set(id, (this.waitingBoxes.get(id) || 0) + 1);
    }
    let acquired = false;
    try {
      do {
        if (!options.waitMs && this.waiting)
          throw new ConflictException('MAILBOX_BUSY');
        acquired = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(73129441)::text`;
          const [count] = await tx.$queryRaw<
            { count: bigint }[]
          >`SELECT COUNT(*) AS count FROM "Mailbox" WHERE "leaseUntil">CURRENT_TIMESTAMP`;
          if (Number(count.count) >= 2) return false;
          const claimed =
            await tx.$executeRaw`UPDATE "Mailbox" SET "leaseToken"=${token},"leaseUntil"=CURRENT_TIMESTAMP + INTERVAL '120 seconds' WHERE id=${id} AND ("leaseUntil" IS NULL OR "leaseUntil"<=CURRENT_TIMESTAMP)`;
          return claimed === 1;
        });
        if (acquired) break;
        if (Date.now() >= deadline) throw new ConflictException('MAILBOX_BUSY');
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(200, deadline - Date.now())),
        );
      } while (true);
    } finally {
      if (options.waitMs) {
        this.waiting--;
        const count = (this.waitingBoxes.get(id) || 1) - 1;
        if (count) this.waitingBoxes.set(id, count);
        else this.waitingBoxes.delete(id);
      }
    }
    let lost = false;
    const assert = async () => {
      const [result] = await this.db.$queryRaw<
        { owned: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM "Mailbox" WHERE id=${id} AND "leaseToken"=${token} AND "leaseUntil">CURRENT_TIMESTAMP) AS owned`;
      if (lost || !result.owned)
        throw new ConflictException('MAILBOX_LEASE_LOST');
    };
    const heartbeat = setInterval(() => {
      void this.db
        .$executeRaw`UPDATE "Mailbox" SET "leaseUntil"=CURRENT_TIMESTAMP + INTERVAL '120 seconds' WHERE id=${id} AND "leaseToken"=${token} AND "leaseUntil">CURRENT_TIMESTAMP`
        .then((r) => {
          if (!r) lost = true;
        })
        .catch(() => {
          lost = true;
        });
    }, 20000);
    heartbeat.unref();
    try {
      return await operation(token, assert);
    } finally {
      clearInterval(heartbeat);
      await this.db.mailbox.updateMany({
        where: { id, leaseToken: token },
        data: { leaseToken: null, leaseUntil: null },
      });
    }
  }
}
