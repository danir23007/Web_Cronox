import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  AnalyticsConsentStatus,
  CustomerActivityEventType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getAnalyticsConfiguration } from './analytics.config';

const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class AnalyticsMaintenanceService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AnalyticsMaintenanceService.name);
  private interval?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.interval = setInterval(() => void this.run(), MAINTENANCE_INTERVAL_MS);
    this.interval.unref?.();
    void this.run();
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const {
        analyticsRetentionDays: analyticsDays,
        loginHistoryRetentionDays: loginDays,
        checkoutAbandonmentMinutes: abandonmentMinutes,
      } = getAnalyticsConfiguration();
      const analyticsCutoff = new Date(now - analyticsDays * 86_400_000);
      const loginCutoff = new Date(now - loginDays * 86_400_000);
      const abandonedCutoff = new Date(now - abandonmentMinutes * 60_000);

      const staleStarts = await this.prisma.customerActivityEvent.findMany({
        where: {
          eventType: CustomerActivityEventType.CHECKOUT_STARTED,
          createdAt: { lt: abandonedCutoff },
          checkoutSnapshotId: { not: null },
          checkoutSnapshot: {
            orderId: null,
            activityEvents: {
              none: {
                eventType: CustomerActivityEventType.CHECKOUT_ABANDONED,
              },
            },
          },
          user: { analyticsConsentStatus: AnalyticsConsentStatus.ACTIVE },
        },
        select: { userId: true, sessionId: true, checkoutSnapshotId: true },
        orderBy: { createdAt: 'asc' },
        take: 500,
      });
      for (const start of staleStarts) {
        if (!start.checkoutSnapshotId) continue;
        try {
          await this.prisma.customerActivityEvent.create({
            data: {
              userId: start.userId,
              sessionId: start.sessionId,
              checkoutSnapshotId: start.checkoutSnapshotId,
              eventType: CustomerActivityEventType.CHECKOUT_ABANDONED,
            },
          });
        } catch (error) {
          if (
            !(
              error instanceof Prisma.PrismaClientKnownRequestError &&
              error.code === 'P2002'
            )
          ) {
            throw error;
          }
        }
      }

      const [events, sessions, logins] = await this.prisma.$transaction([
        this.prisma.customerActivityEvent.deleteMany({
          where: { createdAt: { lt: analyticsCutoff } },
        }),
        this.prisma.analyticsSession.deleteMany({
          where: {
            lastActivityAt: { lt: analyticsCutoff },
            events: { none: {} },
          },
        }),
        this.prisma.userLoginEvent.deleteMany({
          where: { createdAt: { lt: loginCutoff } },
        }),
      ]);
      if (events.count + sessions.count + logins.count > 0) {
        this.logger.log(
          `Retention cleanup removed ${events.count} events, ${sessions.count} sessions and ${logins.count} login records`,
        );
      }
    } catch {
      this.logger.error('Analytics maintenance failed');
    } finally {
      this.running = false;
    }
  }
}
