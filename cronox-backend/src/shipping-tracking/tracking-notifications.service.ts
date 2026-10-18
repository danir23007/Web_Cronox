import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { quotaWaiting } from '../email/mail-account-quota';
import { buildCorreosTrackingUrl } from './tracking-links';
import { eligibleFulfillmentOrder, logisticsMailEnabled, logisticsMilestones, LogisticsMilestone } from './fulfillment-events';
import { logisticsMail } from './logistics-mail';

@Injectable()
export class TrackingNotificationsService {
  constructor(private readonly db: PrismaService, private readonly email: EmailService) {}

  async tick() {
    if (!logisticsMailEnabled('MANUAL')) return;
    // After a crash SMTP may have accepted a message: never automatically resend.
    await this.db.orderTrackingNotification.updateMany({ where: { status: 'SENDING', leaseUntil: { lte: new Date() } },
      data: { status: 'UNKNOWN', leaseToken: null, leaseUntil: null } });
    const jobs = await this.db.orderTrackingNotification.findMany({ where: { ...this.originFilter(), category: { in: logisticsMilestones }, status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' }, take: 2 });
    for (const job of jobs) await this.deliver(job.id);
  }

  async deliver(id: string) {
    if (!logisticsMailEnabled('MANUAL')) return;
    const token = randomUUID();
    const claimed = await this.db.orderTrackingNotification.updateMany({ where: { ...this.originFilter(), id, status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: new Date() } },
      data: { status: 'SENDING', leaseToken: token, leaseUntil: new Date(Date.now() + 120000), attempts: { increment: 1 } } });
    if (!claimed.count) return;
    let sendingStarted = false;
    let attempts = 1;
    const deliveryDeadline = Date.now() + 20000;
    try {
      await this.db.$transaction(async tx => {
        const job = await tx.orderTrackingNotification.findUniqueOrThrow({ where: { id } });
        attempts = job.attempts;
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${job.orderId} FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({ where: { id: job.orderId } });
        if (job.status !== 'SENDING' || job.leaseToken !== token) return;
        if (!logisticsMailEnabled(job.origin)) {
          await tx.orderTrackingNotification.update({ where: { id }, data: { status: 'RETRY', leaseToken: null, leaseUntil: null } }); return;
        }
        if (!logisticsMilestones.includes(job.category as LogisticsMilestone) || job.revision !== order.trackingRevision ||
            !eligibleFulfillmentOrder(order) || job.suppressionReason ||
            job.category === 'DELIVERED' && order.status !== 'DELIVERED' ||
            job.category === 'SHIPPED' && !['SHIPPED', 'DELIVERED'].includes(order.status)) {
          await tx.orderTrackingNotification.update({ where: { id }, data: { status: 'CANCELLED', leaseToken: null, leaseUntil: null } }); return;
        }
        const event = await tx.orderTrackingEvent.findUniqueOrThrow({ where: { id: job.eventId } });
        if (event.orderId !== job.orderId || event.revision !== job.revision) {
          await tx.orderTrackingNotification.update({ where: { id }, data: { status: 'CANCELLED',
            suppressionReason: 'LOGISTICS_EVENT_REVISION_MISMATCH', leaseToken: null, leaseUntil: null } });
          return;
        }
        const template = logisticsMail[job.category as LogisticsMilestone];
        const correos = /^correos$/i.test(order.shippingCarrier?.trim() || '');
        const trackingUrl = correos ? buildCorreosTrackingUrl(order.trackingNumber) : null;
        // Keep the order row locked through SMTP so a number replacement cannot race.
        sendingStarted = true;
        const result = await this.email.send({ type: template.type, deliveryDeadline, to: order.customerEmail,
          subject: `CRONOX · ${template.label} #${order.id}`,
          templateData: { orderId: String(order.id), trackingNumber: order.trackingNumber,
            trackingUrl, shippingCarrier: order.shippingCarrier || undefined,
            title: template.label, message: template.message, statusLabel: template.label,
            orderUrl: undefined, storeUrl: undefined } });
        if (result.queued) throw Object.assign(Error('DELIVERY_DEFERRED_REVIEW'), { deliveryUnknown: true });
        await tx.orderTrackingNotification.update({ where: { id }, data: { status: 'SENT', messageId: result.messageId, leaseToken: null, leaseUntil: null } });
      }, { timeout: 60000, maxWait: 10000 });
    } catch (error) {
      const waiting = quotaWaiting(error);
      // A transaction failure after SMTP started is ambiguous unless the transport
      // explicitly proves rejection. Preserve UNKNOWN instead of risking duplicates.
      const ambiguous = Boolean((error as { deliveryUnknown?: boolean }).deliveryUnknown) ||
        sendingStarted && !waiting && !(error as { getStatus?: () => number }).getStatus;
      await this.db.orderTrackingNotification.updateMany({ where: { id, status: 'SENDING', leaseToken: token },
        data: { status: ambiguous ? 'UNKNOWN' : 'RETRY', leaseToken: null, leaseUntil: null,
          nextAttemptAt: waiting ? error.retryAt : new Date(Date.now() + Math.min(86400000, 60000 * 2 ** Math.min(Math.max(attempts - 1, 0), 11))) } });
    }
  }
  private originFilter() { return logisticsMailEnabled('CORREOS') ? {} : { origin: 'MANUAL' }; }
}
