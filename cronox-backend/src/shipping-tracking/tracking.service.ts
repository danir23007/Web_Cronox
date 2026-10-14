import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { correosConfig, trackingInteger } from './correos.config';
import { CorreosApiError, TrackpubClient } from './trackpub.client';
import { TrackpubContract } from './trackpub.contract';
import { TrackingRequestGate } from './tracking-request-gate';
import { buildCorreosTrackingUrl } from './tracking-links';
import { randomUUID } from 'node:crypto';

export function eligibleTrackingOrder(order: { trackingNumber: string | null; shippingCarrier: string | null; status: string; source: string; shippingMethodCode: string | null }): boolean {
  return Boolean(order.trackingNumber && /^correos$/i.test(order.shippingCarrier?.trim() || '') &&
    ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status) && order.source !== 'IN_PERSON_ADMIN' &&
    !['LOCAL_PICKUP', 'PICKUP'].includes(order.shippingMethodCode || ''));
}

@Injectable()
export class TrackingService {
  constructor(private readonly db: PrismaService, private readonly client: TrackpubClient,
    private readonly contract: TrackpubContract, private readonly requests: TrackingRequestGate) {}

  async getOrderTracking(id: number) {
    const order = await this.db.order.findUnique({ where: { id }, include: {
      shippingLabel: true, trackingAudits: { orderBy: { createdAt: 'desc' }, take: 50 },
    } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const events = await this.db.orderTrackingEvent.findMany({ where: { orderId: id, revision: order.trackingRevision },
      orderBy: [{ eventSortKey: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 500 });
    return {
      revision: order.trackingRevision, number: order.trackingNumber,
      publicUrl: /^correos$/i.test(order.shippingCarrier?.trim() || '') ? buildCorreosTrackingUrl(order.trackingNumber) : order.trackingUrl,
      state: order.trackingState, stateCode: order.trackingStateCode,
      events: events.map(event => ({ id: event.id, occurredAt: event.eventTime, occurredLocalAt: event.eventLocalDate,
        code: event.code, description: event.label, category: event.category })),
      lastSuccessAt: order.trackingLastSuccessAt,
      lastError: order.trackingLastErrorCode ? { code: order.trackingLastErrorCode, at: order.trackingLastErrorAt } : null,
      nextSyncAt: order.trackingNextSyncAt, contractReady: this.contract.ready, apiEnabled: correosConfig().enabled,
      manualAvailableAt: order.trackingLastSuccessAt || order.trackingLastErrorAt
        ? new Date(Math.max(order.trackingLastSuccessAt?.getTime() || 0, order.trackingLastErrorAt?.getTime() || 0) + correosConfig().manualCooldownMs) : null,
      apiReady: Boolean(correosConfig().identityClientId && correosConfig().identityClientSecret && correosConfig().developersClientId && correosConfig().developersClientSecret),
      eligible: eligibleTrackingOrder(order),
      label: order.shippingLabel ? { fileName: order.shippingLabel.originalName, updatedAt: order.shippingLabel.createdAt,
        trackingRevision: order.shippingLabel.trackingRevision, outdated: order.shippingLabel.trackingRevision !== order.trackingRevision } : null,
      audit: order.trackingAudits,
    };
  }

  async syncOrder(id: number, manual = true) {
    const config = correosConfig();
    if (!config.enabled) throw new ServiceUnavailableException({ code: 'TRACKING_DISABLED', message: 'La consulta Trackpub no está habilitada en este entorno.' });
    const claim = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (!eligibleTrackingOrder(order)) throw new BadRequestException('Este pedido no admite sincronización de Correos');
      const now = Date.now();
      const lastAttempt = Math.max(order.trackingLastSuccessAt?.getTime() || 0, order.trackingLastErrorAt?.getTime() || 0);
      if (order.trackingLeaseUntil && order.trackingLeaseUntil.getTime() > now ||
          manual && lastAttempt + config.manualCooldownMs > now ||
          !manual && order.trackingNextSyncAt && order.trackingNextSyncAt.getTime() > now) {
        throw new ConflictException({ code: 'TRACKING_COOLDOWN', message: 'Consulta en curso o demasiado reciente. Espera antes de actualizar.' });
      }
      const token = randomUUID();
      await tx.order.update({ where: { id }, data: { trackingLeaseToken: token,
        trackingLeaseUntil: new Date(now + Math.max(180000, config.timeoutMs * 6 + config.requestSpacingMs)), trackingNextSyncAt: new Date(now + config.manualCooldownMs) } });
      return { ...order, token };
    });
    try {
      const payload = await this.requests.run(() => this.client.search(claim.trackingNumber!));
      const events = this.contract.parse(payload, claim.trackingNumber!);
      await this.db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${id} FOR UPDATE`;
        const current = await tx.order.findUniqueOrThrow({ where: { id } });
        if (current.trackingRevision !== claim.trackingRevision || current.trackingNumber !== claim.trackingNumber || current.trackingLeaseToken !== claim.token) return;
        const previousLatest = await tx.orderTrackingEvent.findFirst({ where: { orderId: id, revision: claim.trackingRevision, eventSortKey: { not: null } }, orderBy: { eventSortKey: 'desc' } });
        for (const event of events) {
          const exists = await tx.orderTrackingEvent.findUnique({ where: { orderId_revision_fingerprint: { orderId: id, revision: claim.trackingRevision, fingerprint: event.fingerprint } } });
          const saved = await tx.orderTrackingEvent.upsert({ where: { orderId_revision_fingerprint: { orderId: id, revision: claim.trackingRevision, fingerprint: event.fingerprint } },
            create: { ...event, orderId: id, revision: claim.trackingRevision }, update: { label: event.label, category: event.category } });
          const afterBaseline = previousLatest?.eventSortKey
            ? Boolean(event.eventSortKey && event.eventSortKey >= previousLatest.eventSortKey)
            : event.fingerprint === events.filter(item => item.eventSortKey).at(-1)?.fingerprint;
          if (!exists && current.trackingBaselineEstablished && eligibleTrackingOrder(current) && event.category && event.eventSortKey && afterBaseline) {
            await tx.orderTrackingNotification.createMany({ data: [{ orderId: id, revision: claim.trackingRevision, eventId: saved.id, category: event.category }], skipDuplicates: true });
          }
        }
        const latest = await tx.orderTrackingEvent.findFirst({ where: { orderId: id, revision: claim.trackingRevision, eventSortKey: { not: null } }, orderBy: [{ eventSortKey: 'desc' }, { createdAt: 'desc' }] });
        const terminal = latest && ['DELIVERED', 'RETURNED'].includes(latest.category || '');
        await tx.order.update({ where: { id }, data: {
          trackingLastSuccessAt: new Date(), trackingLastErrorCode: null, trackingLastErrorAt: null, trackingFailures: 0,
          trackingLeaseToken: null, trackingLeaseUntil: null,
          trackingNextSyncAt: new Date(Date.now() + (terminal ? Math.max(config.intervalMs, 86400000) : config.intervalMs)),
          trackingBaselineEstablished: true,
          ...(latest ? { trackingState: latest.label, trackingStateCode: latest.code, trackingTerminalAt: terminal ? current.trackingTerminalAt || new Date() : null } : {}),
        } });
      });
    } catch (error) {
      const safe = error instanceof CorreosApiError ? error : new CorreosApiError('SYNC_FAILED');
      const attempt = Math.min(claim.trackingFailures + 1, 12);
      const backoff = Math.min(86400000, 60000 * 2 ** Math.min(attempt - 1, 10));
      await this.db.order.updateMany({ where: { id, trackingRevision: claim.trackingRevision, trackingNumber: claim.trackingNumber, trackingLeaseToken: claim.token }, data: {
        trackingLastErrorCode: safe.code, trackingLastErrorAt: new Date(), trackingFailures: attempt,
        trackingLeaseToken: null, trackingLeaseUntil: null,
        trackingNextSyncAt: new Date(Date.now() + Math.max(backoff, safe.retryAfterMs)),
      } });
      if (manual) throw new ServiceUnavailableException({ code: safe.code, message: 'Correos no ha podido actualizar el seguimiento. Se conserva el historial anterior.' });
    }
    return this.getOrderTracking(id);
  }

  async synchronizeDue() {
    const now = new Date();
    const correctionWindow = new Date(Date.now() - trackingInteger('CORREOS_TERMINAL_RECHECK_DAYS', 7, 1, 90) * 86400000);
    const candidates = await this.db.order.findMany({ where: {
      shippingCarrier: { equals: 'Correos', mode: 'insensitive' }, trackingNumber: { not: null },
      source: 'ONLINE', status: { in: ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'] },
      AND: [ { OR: [{ trackingNextSyncAt: null }, { trackingNextSyncAt: { lte: now } }] },
        { OR: [{ shippingMethodCode: null }, { shippingMethodCode: { notIn: ['PICKUP', 'LOCAL_PICKUP'] } }] },
        { OR: [{ trackingLeaseUntil: null }, { trackingLeaseUntil: { lte: now } }] },
        { OR: [{ trackingTerminalAt: null }, { trackingTerminalAt: { gt: correctionWindow } }] } ],
    }, orderBy: { trackingNextSyncAt: { sort: 'asc', nulls: 'first' } }, take: correosConfig().concurrency });
    await Promise.allSettled(candidates.map(order => this.syncOrder(order.id, false)));
  }
}
