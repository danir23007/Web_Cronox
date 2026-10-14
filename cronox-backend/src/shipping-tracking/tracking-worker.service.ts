import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UserNumberingGate } from '../users/user-numbering-gate.module';
import { correosConfig } from './correos.config';
import { TrackingService } from './tracking.service';
import { TrackingNotificationsService } from './tracking-notifications.service';

@Injectable()
export class TrackingWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private readonly logger = new Logger(TrackingWorkerService.name);
  constructor(private readonly tracking: TrackingService, private readonly notifications: TrackingNotificationsService,
    private readonly numbering: UserNumberingGate) {}
  onModuleInit() {
    if (!correosConfig().enabled || process.env.BACKGROUND_JOBS_ENABLED === 'false' || process.env.CRONOX_ROUTE_SMOKE_MODE === 'true') return;
    this.timer = setInterval(() => { void this.tick().catch(() => this.logger.warn('CORREOS_WORKER_FAILED')); }, 10000);
    this.timer.unref();
  }
  async tick() {
    if (this.running || this.stopped || !correosConfig().enabled || process.env.BACKGROUND_JOBS_ENABLED === 'false') return;
    this.running = true;
    try { await this.numbering.shared(async () => { await this.tracking.synchronizeDue(); await this.notifications.tick(); }); }
    finally { this.running = false; }
  }
  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    while (this.running) await new Promise(resolve => setTimeout(resolve, 100));
  }
}
