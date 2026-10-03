import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailboxSyncService } from './mailbox-sync.service';
import { MailboxSenderService } from './mailbox-sender.service';
import { MailboxPushService } from './mailbox-push.service';
import { MailboxReaderService } from './mailbox-reader.service';
import { keyring } from './mailbox-security';
@Injectable()
export class MailboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(
    readonly db: PrismaService,
    readonly sync: MailboxSyncService,
    readonly sender: MailboxSenderService,
    readonly push: MailboxPushService,
    readonly reader: MailboxReaderService,
  ) {}
  onModuleInit() {
    if (
      process.env.MAILBOX_WORKER_ENABLED !== 'true' ||
      process.env.BACKGROUND_JOBS_ENABLED === 'false' ||
      process.env.CRONOX_ROUTE_SMOKE_MODE === 'true'
    )
      return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, 5000);
    this.timer.unref();
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise((r) => setTimeout(r, 100));
  }
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.sender.recover();
      if (process.env.MAILBOX_SEND_ENABLED === 'true') {
        const queued = await this.db.mailboxSend.findMany({
          where: { status: 'PENDING' },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: 2,
        });
        await Promise.allSettled(queued.map((s) => this.sender.process(s.id)));
      }
      const boxes = await this.db.mailbox.findMany({
        where: { active: true, nextSyncAt: { lte: new Date() } },
        orderBy: { nextSyncAt: 'asc' },
        take: 2,
        select: { id: true },
      });
      await Promise.allSettled(boxes.map((b) => this.sync.sync(b.id, true)));
      let canCache = false;
      try {
        keyring();
        this.reader.files.root();
        canCache = true;
      } catch {}
      if (canCache) {
        for (const box of boxes) {
          const message = await this.db.mailboxMessage.findFirst({
            where: {
              mailboxId: box.id,
              alive: true,
              bodyState: 'NOT_LOADED',
              size: { lt: 1024 * 1024 },
              folder: { available: true },
            },
            orderBy: { date: 'desc' },
            select: { id: true },
          });
          if (message)
            await this.reader.cacheSystem(message.id).catch(() => {});
        }
      }
      if (this.push.config().configured) {
        const devices = await this.db.mailboxPushDevice.findMany({
          where: { active: true, nextPushAt: { lte: new Date() } },
          select: { id: true },
          take: 10,
          orderBy: { nextPushAt: 'asc' },
        });
        for (const d of devices) await this.push.deliver(d.id);
      }
    } finally {
      this.running = false;
    }
  }
}
