import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailboxSyncService } from './mailbox-sync.service';
import { MailboxSenderService } from './mailbox-sender.service';
import { MailboxPushService } from './mailbox-push.service';
import { MailboxReaderService } from './mailbox-reader.service';
import { keyring } from './mailbox-security';
import { MailboxCampaignService } from './mailbox-campaign.service';
import { AdminEventPushService } from './admin-event-push.service';
import { MailboxRetentionService } from './mailbox-retention.service';
@Injectable()
export class MailboxWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailboxWorkerService.name);
  private readonly cacheRetry = new Map<string, number>();
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(
    readonly db: PrismaService,
    readonly sync: MailboxSyncService,
    readonly sender: MailboxSenderService,
    readonly push: MailboxPushService,
    readonly reader: MailboxReaderService,
    readonly campaigns?: MailboxCampaignService,
    readonly events?: AdminEventPushService,
    readonly retention?: MailboxRetentionService,
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
      await this.campaigns?.recover();
      await this.retention?.tick().catch(() => this.logger.warn('MAILBOX_RETENTION_FAILED_RETRY_PENDING'));
      if (process.env.MAILBOX_SEND_ENABLED === 'true') {
        const queued = await this.db.mailboxSend.findMany({
          where: { status: 'PENDING', OR: [{ readyAt: null }, { readyAt: { lte: new Date() } }] },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
          take: 2,
        });
        await Promise.allSettled(queued.map((s) => this.sender.process(s.id)));
        await this.campaigns?.tick();
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
        for (const [id, until] of this.cacheRetry)
          if (until <= Date.now()) this.cacheRetry.delete(id);
        for (const box of boxes) {
          const message = await this.db.mailboxMessage.findFirst({
            where: {
              mailboxId: box.id,
              alive: true,
              bodyState: { in: ['NOT_LOADED', 'FAILED'] },
              id: { notIn: [...this.cacheRetry.keys()] },
              size: { lt: 1024 * 1024 },
              folder: { available: true },
            },
            orderBy: { date: 'desc' },
            select: { id: true },
          });
          if (message)
            await this.reader.cacheSystem(message.id).catch(() => {
              this.cacheRetry.set(message.id, Date.now() + 15 * 60000);
            });
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
        const eventDevices = await this.db.mailboxPushDevice.findMany({
          where: {
            active: true,
            OR: [
              { paidOrdersSince: { not: null } },
              { visitsSince: { not: null } },
              { waitlistSince: { not: null } },
            ],
          },
          select: { id: true },
          take: 100,
          orderBy: { updatedAt: 'asc' },
        });
        for (const d of eventDevices) await this.events?.deliver(d.id);
      }
    } finally {
      this.running = false;
    }
  }
}
