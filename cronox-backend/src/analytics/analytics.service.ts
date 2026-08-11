import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AnalyticsConsentStatus,
  CustomerActivityEventType,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsConsentDto } from './dto/analytics-consent.dto';
import {
  AnalyticsEventDto,
  IngestAnalyticsEventsDto,
} from './dto/analytics-event.dto';
import {
  ANALYTICS_CONSENT_VERSION,
  getAnalyticsSessionId,
  hasAnalyticsConsent,
} from './analytics-consent';
import { getAnalyticsConfiguration } from './analytics.config';

const { sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES } =
  getAnalyticsConfiguration();
const SESSION_TIMEOUT_MS = SESSION_TIMEOUT_MINUTES * 60_000;

type ServerEventFields = {
  productId?: number;
  variantId?: number;
  quantity?: number;
  previousQuantity?: number;
  checkoutSnapshotId?: string;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  getClientConfig() {
    return {
      sessionTimeoutMinutes: SESSION_TIMEOUT_MINUTES,
      heartbeatSeconds: 45,
    };
  }

  async syncConsent(userId: number, dto: AnalyticsConsentDto, req: Request) {
    if (
      dto.granted &&
      (dto.version !== ANALYTICS_CONSENT_VERSION || !hasAnalyticsConsent(req))
    ) {
      throw new BadRequestException('ANALYTICS_CONSENT_COOKIE_REQUIRED');
    }

    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        analyticsConsentStatus: true,
        analyticsFirstGrantedAt: true,
      },
    });
    const now = new Date();
    const status = dto.granted
      ? AnalyticsConsentStatus.ACTIVE
      : current?.analyticsConsentStatus === AnalyticsConsentStatus.ACTIVE ||
          current?.analyticsFirstGrantedAt
        ? AnalyticsConsentStatus.WITHDRAWN
        : AnalyticsConsentStatus.REJECTED;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        analyticsConsentStatus: status,
        analyticsConsentVersion: dto.version,
        analyticsConsentDecidedAt: now,
        ...(dto.granted
          ? {
              analyticsFirstGrantedAt: current?.analyticsFirstGrantedAt ?? now,
              analyticsLastGrantedAt: now,
            }
          : {}),
      },
    });
    return { status };
  }

  async ingest(userId: number, req: Request, dto: IngestAnalyticsEventsDto) {
    if (!hasAnalyticsConsent(req)) {
      return { accepted: 0, reason: 'ANALYTICS_CONSENT_REQUIRED' };
    }

    await this.markConsentActive(userId);
    const sessionId = await this.resolveSession(userId, dto.sessionId);
    let accepted = 0;

    for (const event of dto.events) {
      const data = await this.validateClientEvent(event);
      try {
        await this.prisma.customerActivityEvent.create({
          data: {
            userId,
            sessionId,
            clientEventId: event.clientEventId,
            ...data,
          },
        });
        accepted += 1;
        if (data.activeSeconds) {
          await this.prisma.analyticsSession.update({
            where: { id: sessionId },
            data: { activeSeconds: { increment: data.activeSeconds } },
          });
        }
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) throw error;
      }
    }

    await this.prisma.analyticsSession.update({
      where: { id: sessionId },
      data: { lastActivityAt: new Date() },
    });
    return { accepted, sessionId };
  }

  async recordServerEvent(
    req: Request,
    userId: number,
    eventType: CustomerActivityEventType,
    fields: ServerEventFields = {},
  ): Promise<void> {
    if (!hasAnalyticsConsent(req)) return;
    await this.markConsentActive(userId);
    const sessionId = await this.resolveSession(
      userId,
      getAnalyticsSessionId(req) ?? randomUUID(),
    );
    try {
      await this.prisma.customerActivityEvent.create({
        data: { userId, sessionId, eventType, ...fields },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
    }
  }

  private async validateClientEvent(
    event: AnalyticsEventDto,
  ): Promise<
    Omit<
      Prisma.CustomerActivityEventUncheckedCreateInput,
      'id' | 'userId' | 'sessionId' | 'clientEventId' | 'createdAt'
    >
  > {
    const data: Record<string, unknown> = { eventType: event.eventType };
    if (event.eventType === CustomerActivityEventType.PRODUCT_VIEWED) {
      if (!event.productId)
        throw new BadRequestException('PRODUCT_ID_REQUIRED');
      const exists = await this.prisma.product.count({
        where: { id: event.productId },
      });
      if (!exists) throw new BadRequestException('PRODUCT_NOT_FOUND');
      data.productId = event.productId;
    } else if (event.eventType === CustomerActivityEventType.SEARCH_PERFORMED) {
      const query = this.sanitizeSearch(event.searchQuery);
      if (!query) throw new BadRequestException('SEARCH_QUERY_REQUIRED');
      data.searchQuery = query;
      data.resultCount = event.resultCount ?? 0;
    } else if (event.eventType === CustomerActivityEventType.CATEGORY_VIEWED) {
      const slug = event.categorySlug?.trim().toLowerCase();
      if (!slug) throw new BadRequestException('CATEGORY_SLUG_REQUIRED');
      const exists = await this.prisma.category.count({ where: { slug } });
      if (!exists) throw new BadRequestException('CATEGORY_NOT_FOUND');
      data.categorySlug = slug;
    } else if (event.eventType === CustomerActivityEventType.ACTIVE_TIME) {
      if (!event.activeSeconds)
        throw new BadRequestException('ACTIVE_SECONDS_REQUIRED');
      data.activeSeconds = event.activeSeconds;
      if (event.productId) {
        const exists = await this.prisma.product.count({
          where: { id: event.productId },
        });
        if (!exists) throw new BadRequestException('PRODUCT_NOT_FOUND');
        data.productId = event.productId;
      }
    }
    return data as never;
  }

  private sanitizeSearch(value?: string): string {
    return (value ?? '')
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted]')
      .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, '[redacted]')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  private async markConsentActive(userId: number): Promise<void> {
    const now = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        analyticsConsentStatus: AnalyticsConsentStatus.ACTIVE,
        analyticsConsentVersion: ANALYTICS_CONSENT_VERSION,
        analyticsConsentDecidedAt: now,
        analyticsLastGrantedAt: now,
      },
    });
    // Prisma cannot express "set only when null" in the update above.
    await this.prisma.$executeRaw`
      UPDATE "User" SET "analyticsFirstGrantedAt" = ${now}
      WHERE "id" = ${userId} AND "analyticsFirstGrantedAt" IS NULL
    `;
  }

  private async resolveSession(
    userId: number,
    requestedId: string,
  ): Promise<string> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - SESSION_TIMEOUT_MS);
    const requested = await this.prisma.analyticsSession.findUnique({
      where: { id: requestedId },
    });
    if (requested) {
      if (requested.userId !== userId)
        throw new BadRequestException('INVALID_ANALYTICS_SESSION');
      if (requested.lastActivityAt >= cutoff) return requested.id;
    }

    const active = await this.prisma.analyticsSession.findFirst({
      where: { userId, lastActivityAt: { gte: cutoff } },
      orderBy: { lastActivityAt: 'desc' },
    });
    if (active) return active.id;

    const id = requested ? randomUUID() : requestedId;
    await this.prisma.analyticsSession.create({ data: { id, userId } });
    return id;
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
