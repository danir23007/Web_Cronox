import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { serializableTransaction } from '../prisma/serializable-transaction';
import { reconcileCircle2 } from './circle-policy';

@Injectable()
export class CircleReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CircleReconciliationService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (process.env.CRONOX_ROUTE_SMOKE_MODE === 'true') return;
    const run = () => { void this.drainQueue().catch(error => this.logger.error('Circle reconciliation remains queued for retry', error)); };
    this.timer = setInterval(run, 1000);
    this.timer.unref();
    run();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async drainQueue(limit = 50) {
    if (this.running || limit <= 0) return 0;
    this.running = true;
    let processed = 0;
    try {
      // An empty queue needs one read instead of an idle serializable
      // transaction. Work arriving just after this probe runs on the next tick.
      if (!await this.prisma.circleReconciliationQueue.findFirst({ select: { userId: true } })) return 0;
      while (processed < limit) {
        const changed = await serializableTransaction(this.prisma, async tx => {
          const [work] = await tx.$queryRaw<Array<{ userId: number; version: number }>>`
            SELECT "userId",version FROM "CircleReconciliationQueue" ORDER BY "userId" LIMIT 1 FOR UPDATE SKIP LOCKED`;
          if (!work) return false;
          // A manual transaction can hold User and then enqueue order changes.
          // Never wait on that lock while holding its queue row: release and retry.
          const users = await tx.$queryRaw<Array<{ id: number }>>`
            SELECT id FROM "User" WHERE id=${work.userId} FOR UPDATE SKIP LOCKED`;
          if (!users.length) return false;
          await reconcileCircle2(tx, work.userId);
          await tx.circleReconciliationQueue.deleteMany({ where: { userId: work.userId, version: work.version } });
          return true;
        });
        if (!changed) break;
        processed++;
      }
      return processed;
    } finally { this.running = false; }
  }
}
