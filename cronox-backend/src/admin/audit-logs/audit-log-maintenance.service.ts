import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { auditLogRetentionCutoff } from './audit-log-retention';

export const AUDIT_LOG_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuditLogMaintenanceService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AuditLogMaintenanceService.name);
  private interval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.CRONOX_ROUTE_SMOKE_MODE === 'true') return;
    this.interval = setInterval(
      () => void this.cleanup(),
      AUDIT_LOG_CLEANUP_INTERVAL_MS,
    );
    this.interval.unref?.();
    void this.cleanup();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  async cleanup(now = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const result = await this.prisma.auditLog.deleteMany({
        where: { createdAt: { lt: auditLogRetentionCutoff(now) } },
      });
      if (result.count > 0) {
        this.logger.log(
          `AuditLog retention cleanup removed ${result.count} rows`,
        );
      }
      return result.count;
    } catch {
      this.logger.error('AuditLog retention cleanup failed');
      return 0;
    } finally {
      this.running = false;
    }
  }
}
