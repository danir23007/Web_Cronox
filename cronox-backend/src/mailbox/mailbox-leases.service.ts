import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class MailboxLeasesService {
  constructor(private readonly db: PrismaService) {}
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
  ): Promise<T> {
    const token = randomUUID();
    const acquired = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(73129441)::text`;
      const [count] = await tx.$queryRaw<
        { count: bigint }[]
      >`SELECT COUNT(*) AS count FROM "Mailbox" WHERE "leaseUntil">CURRENT_TIMESTAMP`;
      if (Number(count.count) >= 2) return false;
      const claimed =
        await tx.$executeRaw`UPDATE "Mailbox" SET "leaseToken"=${token},"leaseUntil"=CURRENT_TIMESTAMP + INTERVAL '120 seconds' WHERE id=${id} AND ("leaseUntil" IS NULL OR "leaseUntil"<=CURRENT_TIMESTAMP)`;
      return claimed === 1;
    });
    if (!acquired) throw new ConflictException('MAILBOX_BUSY');
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
