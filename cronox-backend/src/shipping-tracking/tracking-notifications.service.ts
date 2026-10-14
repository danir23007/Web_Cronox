import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { EmailType } from '../email/email.types';
import { quotaWaiting } from '../email/mail-account-quota';
import { buildCorreosTrackingUrl } from './tracking-links';
import { eligibleTrackingOrder } from './tracking.service';

@Injectable()
export class TrackingNotificationsService {
  constructor(private readonly db: PrismaService, private readonly email: EmailService) {}

  async tick() {
    if (process.env.EMAIL_ENABLED !== 'true' || process.env.CORREOS_EMAIL_ENABLED !== 'true' ||
        process.env.BACKGROUND_JOBS_ENABLED === 'false') return;
    // After a crash SMTP may have accepted a message: never automatically resend.
    await this.db.orderTrackingNotification.updateMany({ where: { status: 'SENDING', leaseUntil: { lte: new Date() } },
      data: { status: 'UNKNOWN', leaseToken: null, leaseUntil: null } });
    const jobs = await this.db.orderTrackingNotification.findMany({ where: { status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' }, take: 2 });
    for (const job of jobs) await this.deliver(job.id);
  }

  async deliver(id: string) {
    if (process.env.EMAIL_ENABLED !== 'true' || process.env.CORREOS_EMAIL_ENABLED !== 'true' || process.env.BACKGROUND_JOBS_ENABLED === 'false') return;
    const token = randomUUID();
    const claimed = await this.db.orderTrackingNotification.updateMany({ where: { id, status: { in: ['PENDING', 'RETRY'] }, nextAttemptAt: { lte: new Date() } },
      data: { status: 'SENDING', leaseToken: token, leaseUntil: new Date(Date.now() + 120000), attempts: { increment: 1 } } });
    if (!claimed.count) return;
    let sendingStarted = false;
    const deliveryDeadline = Date.now() + 20000;
    try {
      await this.db.$transaction(async tx => {
        const job = await tx.orderTrackingNotification.findUniqueOrThrow({ where: { id } });
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${job.orderId} FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({ where: { id: job.orderId } });
        if (job.status !== 'SENDING' || job.leaseToken !== token) return;
        if (job.revision !== order.trackingRevision || !eligibleTrackingOrder(order)) {
          await tx.orderTrackingNotification.update({ where: { id }, data: { status: 'CANCELLED', leaseToken: null, leaseUntil: null } }); return;
        }
        const event = await tx.orderTrackingEvent.findUniqueOrThrow({ where: { id: job.eventId } });
        const trackingUrl = buildCorreosTrackingUrl(order.trackingNumber)!;
        // Keep the order row locked through SMTP so a number replacement cannot race.
        sendingStarted = true;
        const result = await this.email.send({ type: EmailType.ORDER_TRACKING, deliveryDeadline, to: order.customerEmail,
          subject: `CRONOX · Seguimiento del pedido #${order.id}`,
          templateData: { orderId: String(order.id), trackingNumber: order.trackingNumber,
            trackingUrl, shippingCarrier: 'Correos', statusLabel: event.label || event.code } });
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
          nextAttemptAt: waiting ? error.retryAt : new Date(Date.now() + 300000) } });
    }
  }
}
