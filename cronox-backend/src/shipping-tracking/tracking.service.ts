import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { correosConfig, trackingInteger } from './correos.config';
import { CorreosApiError, TrackpubClient } from './trackpub.client';
import { TrackpubContract } from './trackpub.contract';
import { TrackingRequestGate } from './tracking-request-gate';
import { buildCorreosTrackingUrl, trackingBatchError } from './tracking-links';
import { randomUUID } from 'node:crypto';
import { fulfillmentEvidence, shippedNoticeDecision } from './fulfillment-policy';

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
      trackingNotifications: { orderBy: { createdAt: 'desc' }, take: 20,
        select: { status: true, category: true, attempts: true, createdAt: true } },
    } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    const events = await this.db.orderTrackingEvent.findMany({ where: { orderId: id, revision: order.trackingRevision },
      orderBy: [{ eventSortKey: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 500 });
    return {
      revision: order.trackingRevision, number: order.trackingNumber,
      publicUrl: /^correos$/i.test(order.shippingCarrier?.trim() || '') ? buildCorreosTrackingUrl(order.trackingNumber) : order.trackingUrl,
      state: order.trackingState, stateCode: order.trackingStateCode,
      admissionLocalAt: order.trackingAdmissionLocalAt, deliveryLocalAt: order.trackingDeliveryLocalAt,
      notificationReview: order.trackingNotificationReview,
      notifications: order.trackingNotifications || [],
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
        if (!eligibleTrackingOrder(current)) {
          await tx.order.update({ where: { id }, data: { trackingLeaseToken: null, trackingLeaseUntil: null } });
          return;
        }
        for (const event of events) {
          await tx.orderTrackingEvent.upsert({ where: { orderId_revision_fingerprint: { orderId: id, revision: claim.trackingRevision, fingerprint: event.fingerprint } },
            create: { ...event, orderId: id, revision: claim.trackingRevision }, update: { label: event.label, category: event.category } });
        }
        const history = await tx.orderTrackingEvent.findMany({ where: { orderId: id, revision: claim.trackingRevision } });
        const evidence = fulfillmentEvidence(history as typeof events);
        const fulfillment: Record<string, unknown> = {};
        const transition = ['PAID', 'PROCESSING'].includes(current.status) && evidence.physical;
        if (transition || current.status === 'SHIPPED' && evidence.delivered) {
          const status = evidence.delivered ? 'DELIVERED' : 'SHIPPED';
          fulfillment.status = status;
          await tx.orderTrackingAudit.create({ data: { orderId: id, revision: claim.trackingRevision,
            previousNumber: current.trackingNumber, nextNumber: current.trackingNumber,
            action: 'CORREOS_FULFILLMENT', previousStatus: current.status, nextStatus: status } });
        }
        // A missing admission timestamp is never replaced with our query time.
        if (!current.shippedAt && evidence.admission?.eventTime) fulfillment.shippedAt = evidence.admission.eventTime;
        if (!current.deliveredAt && evidence.delivery?.eventTime) fulfillment.deliveredAt = evidence.delivery.eventTime;
        if (!current.trackingAdmissionLocalAt && evidence.admission?.eventLocalDate) fulfillment.trackingAdmissionLocalAt = evidence.admission.eventLocalDate;
        if (!current.trackingDeliveryLocalAt && evidence.delivery?.eventLocalDate) fulfillment.trackingDeliveryLocalAt = evidence.delivery.eventLocalDate;
        if (transition) {
          const cutoff = await tx.correosTrackingGate.findUnique({ where: { key: 'SHIPPED_EMAIL_CUTOFF' } });
          const review = evidence.delivered ? 'ALREADY_DELIVERED_AT_FIRST_SYNC' : shippedNoticeDecision(evidence.admission, cutoff?.notBefore || null, current);
          fulfillment.trackingNotificationReview = review;
          if (!review) {
            const admitted = history.find(e => e.fingerprint === evidence.admission!.fingerprint)!;
            await tx.orderTrackingNotification.createMany({ data: [{ orderId: id, revision: claim.trackingRevision,
              eventId: admitted.id, category: 'SHIPPED' }], skipDuplicates: true });
          }
        }
        const latest = await tx.orderTrackingEvent.findFirst({ where: { orderId: id, revision: claim.trackingRevision, eventSortKey: { not: null } }, orderBy: [{ eventSortKey: 'desc' }, { createdAt: 'desc' }] });
        const rank: Record<string, number> = { ADMITTED: 1, IN_TRANSIT: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4 };
        const phase = [...history].filter(e => rank[e.category || '']).sort((a, b) =>
          rank[b.category!] - rank[a.category!] || (b.eventSortKey || '').localeCompare(a.eventSortKey || ''))[0];
        const display = latest && ['INCIDENT', 'RETURNED'].includes(latest.category || '') ? latest : phase || latest;
        const terminal = evidence.delivered || latest && latest.category === 'RETURNED';
        await tx.order.update({ where: { id }, data: {
          ...fulfillment,
          trackingLastSuccessAt: new Date(), trackingLastErrorCode: null, trackingLastErrorAt: null, trackingFailures: 0,
          trackingLeaseToken: null, trackingLeaseUntil: null,
          trackingNextSyncAt: new Date(Date.now() + (terminal ? Math.max(config.intervalMs, 86400000) : config.intervalMs)),
          trackingBaselineEstablished: true,
          trackingTerminalAt: terminal ? current.trackingTerminalAt || new Date() : current.trackingTerminalAt,
          ...(display && current.status !== 'DELIVERED' && !evidence.delivered ? {
            trackingState: evidence.physical || display.category === 'INCIDENT' || display.category === 'RETURNED'
              ? display.label : 'Pendiente de entregar a Correos', trackingStateCode: display.code } : {}),
          ...(evidence.delivered ? { trackingState: 'Entregado', trackingStateCode: evidence.delivery?.code || 'I010000V' } : {}),
        } });
      });
    } catch (error) {
      const safe = error instanceof CorreosApiError ? error : new CorreosApiError('SYNC_FAILED');
      const attempt = Math.min(claim.trackingFailures + 1, 12);
      const backoff = Math.min(86400000, 60000 * 2 ** Math.min(attempt - 1, 11));
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

  async syncBulk(orderIds: unknown[]) {
    if (!Array.isArray(orderIds) || !orderIds.length || orderIds.length > 100) throw new BadRequestException('Selecciona entre 1 y 100 pedidos visibles');
    const results: Record<string, unknown>[] = [];
    const seen = new Set<number>();
    // Sequential on purpose: the shared request gate enforces process-wide quotas.
    for (const id of orderIds) {
      try {
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || seen.has(id)) throw new BadRequestException('ID de pedido inválido o repetido');
        seen.add(id);
        const before = await this.db.order.findUnique({ where: { id } });
        if (!before) throw new NotFoundException('Pedido no encontrado');
        const countBefore = await this.db.orderTrackingEvent.count({ where: { orderId: id, revision: before.trackingRevision } });
        await this.syncOrder(id);
        const after = await this.db.order.findUniqueOrThrow({ where: { id } });
        const countAfter = await this.db.orderTrackingEvent.count({ where: { orderId: id, revision: after.trackingRevision } });
        const changed = before.status !== after.status || before.trackingStateCode !== after.trackingStateCode ||
          before.trackingState !== after.trackingState || before.trackingAdmissionLocalAt !== after.trackingAdmissionLocalAt ||
          before.trackingDeliveryLocalAt !== after.trackingDeliveryLocalAt || countAfter !== countBefore;
        results.push({ orderId: id, status: changed ? 'updated' : 'unchanged', orderStatus: after.status, notificationReview: after.trackingNotificationReview });
      } catch (error) {
        results.push({ orderId: id, status: 'error', error: trackingBatchError(error) });
      }
    }
    return { results };
  }
}
