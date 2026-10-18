import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailboxPushService } from './mailbox-push.service';

export const pushPreferenceColumn = {
  paidOrders: 'paidOrdersSince',
  visits: 'visitsSince',
  waitlist: 'waitlistSince',
};
export function eventPayload(event: any) {
  const p = event.payload,
    tag = 'cronox-event-' + event.id;
  if (event.kind === 'paidOrders') {
    let amount = '';
    try {
      amount = new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: p.currency,
      }).format(Number(p.total));
    } catch {
      amount = String(p.total) + ' ' + String(p.currency);
    }
    return {
      title: 'CRONOX · Pedidos',
      body: `Nuevo pedido pagado · Pedido #${p.orderId} · ${amount}`,
      tag,
      url: `/admin.html#section-orders?order=${p.orderId}`,
    };
  }
  if (event.kind === 'visits')
    return {
      title: 'CRONOX · Visitas',
      body: 'Nueva visita a CRONOX',
      tag,
      url: '/admin.html#section-dashboard',
    };
  return {
    title: 'CRONOX · Waitlist',
    body: `Nueva solicitud en la waitlist · ${String(p.product).slice(0, 100)} · Talla ${String(p.size).replace('US_', 'US ')}`,
    tag,
    url: '/admin.html#section-waitlist',
  };
}
@Injectable()
export class AdminEventPushService {
  constructor(
    readonly db: PrismaService,
    readonly push: MailboxPushService,
  ) {}
  private async permitted(device: any, delivery: any) {
    if (!device?.active || device.leaseUntil <= new Date()) return false;
    const column = pushPreferenceColumn[delivery.event.kind];
    if (
      !column ||
      !device[column] ||
      device[column].getTime() !== delivery.enabledSince.getTime()
    )
      return false;
    let session;
    try {
      session = await this.push.sessions.validate({
        sub: device.userId,
        sid: device.sessionId,
        sv: device.sessionVersion,
        type: 'access',
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) return false;
      throw error;
    }
    if (
      !['ADMIN', 'SUPERADMIN'].includes(session.user.role) ||
      (delivery.event.kind === 'paidOrders' &&
        session.user.role !== 'SUPERADMIN')
    )
      return false;
    const p = delivery.event.payload;
    if (delivery.event.kind === 'paidOrders') {
      const order = await this.db.order.findUnique({
        where: { id: p.orderId },
        select: {
          status: true,
          paidAt: true,
          source: true,
          purchasedAt: true,
          voidedAt: true,
          disputeLostCents: true,
        },
      });
      return (
        !!(order?.paidAt || order?.source==='IN_PERSON_ADMIN' && order.purchasedAt) &&
        !order.voidedAt &&
        !order.disputeLostCents &&
        ['PAID', 'PROCESSING', 'SHIPPED', 'DELIVERED'].includes(order.status)
      );
    }
    if (delivery.event.kind === 'visits') {
      const visit = await this.db.dailyVisitor.findUnique({
        where: { id: p.visitorId },
        include: { browserLinks: { include: { browser: true } } },
      });
      return (
        !!visit &&
        visit.disposition !== 'adminExcluded' &&
        !['ADMIN', 'SUPERADMIN'].includes(visit.observedRole || '') &&
        !visit.browserLinks.some((l) => l.browser.adminExcluded)
      );
    }
    const row = await this.db.restockRequest.findUnique({
      where: { id: delivery.event.id.slice('waitlist:'.length) },
      select: { status: true },
    });
    return !!row && row.status !== 'CANCELLED';
  }
  async deliver(id: string) {
    if (!this.push.config().configured) return;
    const now = new Date(),
      lease = new Date(now.getTime() + 60000);
    const claim = await this.db.mailboxPushDevice.updateMany({
      where: {
        id,
        active: true,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseUntil: lease },
    });
    if (!claim.count) return;
    try {
      // A process lost after contacting a vendor has an uncertain outcome. Never
      // replay automatically; explicit 429/5xx rejection can be retried safely.
      await this.db.mailboxPushDelivery.updateMany({
        where: { deviceId: id, status: 'PROCESSING' },
        data: { status: 'UNKNOWN', errorCode: 'PUSH_OUTCOME_UNKNOWN' },
      });
      const delivery = await this.db.mailboxPushDelivery.findFirst({
        where: { deviceId: id, status: 'PENDING', readyAt: { lte: now } },
        include: { event: true },
        orderBy: [{ readyAt: 'asc' }, { eventId: 'asc' }],
      });
      if (!delivery) return;
      const key = {
        eventId_deviceId: { eventId: delivery.eventId, deviceId: id },
      };
      let device = await this.db.mailboxPushDevice.findUniqueOrThrow({
        where: { id },
      });
      let permitted;
      try {
        permitted = await this.permitted(device, delivery);
      } catch {
        await this.db.mailboxPushDelivery.updateMany({
          where: { eventId: delivery.eventId, deviceId: id, status: 'PENDING' },
          data: {
            readyAt: new Date(Date.now() + 30000),
            errorCode: 'PUSH_VALIDATION_UNAVAILABLE',
          },
        });
        return;
      }
      if (!permitted) {
        await this.db.mailboxPushDelivery.update({
          where: key,
          data: { status: 'SKIPPED' },
        });
        return;
      }
      // Re-read preferences immediately before transport (including remote edits).
      try {
        device = await this.db.mailboxPushDevice.findUniqueOrThrow({
          where: { id },
        });
        permitted = await this.permitted(device, delivery);
      } catch {
        await this.db.mailboxPushDelivery.updateMany({
          where: { eventId: delivery.eventId, deviceId: id, status: 'PENDING' },
          data: {
            readyAt: new Date(Date.now() + 30000),
            errorCode: 'PUSH_VALIDATION_UNAVAILABLE',
          },
        });
        return;
      }
      if (device.leaseUntil?.getTime() !== lease.getTime() || !permitted) {
        await this.db.mailboxPushDelivery.update({
          where: key,
          data: { status: 'SKIPPED' },
        });
        return;
      }
      await this.db.mailboxPushDelivery.update({
        where: key,
        data: {
          status: 'PROCESSING',
          startedAt: now,
          attempts: { increment: 1 },
        },
      });
      try {
        await this.push.sendPayload(
          device,
          eventPayload(delivery.event),
          async () => {
            let fresh, permitted;
            try {
              fresh = await this.db.mailboxPushDevice.findUniqueOrThrow({
                where: { id },
              });
              permitted = await this.permitted(fresh, delivery);
            } catch {
              // This callback runs before any request to the push provider.
              throw Object.assign(Error('PUSH_VALIDATION_UNAVAILABLE'), {
                code: 'PUSH_VALIDATION_UNAVAILABLE',
              });
            }
            if (fresh.leaseUntil?.getTime() !== lease.getTime() || !permitted)
              throw Object.assign(Error('PUSH_PREFERENCES_DISABLED'), {
                code: 'PUSH_PREFERENCES_DISABLED',
              });
          },
        );
        await this.db.mailboxPushDelivery.updateMany({
          where: {
            eventId: delivery.eventId,
            deviceId: id,
            status: 'PROCESSING',
            startedAt: now,
          },
          data: { status: 'ACCEPTED', errorCode: null },
        });
      } catch (e: any) {
        const code = Number(e.statusCode),
          validationUnavailable = e.code === 'PUSH_VALIDATION_UNAVAILABLE',
          retry =
            [429, 500, 502, 503, 504].includes(code) && delivery.attempts < 4;
        await this.db.mailboxPushDelivery.updateMany({
          where: {
            eventId: delivery.eventId,
            deviceId: id,
            status: 'PROCESSING',
            startedAt: now,
          },
          data: {
            status: validationUnavailable
              ? 'PENDING'
              : e.code === 'PUSH_PREFERENCES_DISABLED'
                ? 'SKIPPED'
                : retry
                  ? 'PENDING'
                  : code
                    ? 'FAILED'
                    : 'UNKNOWN',
            errorCode: validationUnavailable
              ? 'PUSH_VALIDATION_UNAVAILABLE'
              : e.code === 'PUSH_PREFERENCES_DISABLED'
                ? 'PUSH_PREFERENCES_DISABLED'
                : retry
                  ? 'PUSH_TEMPORARY_REJECTION'
                  : code
                    ? 'PUSH_REJECTED'
                    : 'PUSH_OUTCOME_UNKNOWN',
            ...(validationUnavailable ? { attempts: { decrement: 1 } } : {}),
            readyAt: new Date(
              Date.now() +
                (validationUnavailable
                  ? 30000
                  : Math.min(3600000, 30000 * 2 ** delivery.attempts)),
            ),
          },
        });
        if ([404, 410].includes(code))
          await this.db.mailboxPushDevice.updateMany({
            where: { id, leaseUntil: lease },
            data: { active: false },
          });
      }
    } catch {
      // Core domain writes already committed; push failures remain isolated.
    } finally {
      await this.db.mailboxPushDevice
        .updateMany({
          where: { id, leaseUntil: lease },
          data: { leaseUntil: null },
        })
        .catch(() => {});
    }
  }
}
