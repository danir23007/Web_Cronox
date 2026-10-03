import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Agent } from 'node:https';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { AuthSessionsService } from '../auth/auth-sessions.service';
import { MailboxAccessService, MailActor } from './mailbox-access.service';
import { decrypt, encrypt, resolvePublic } from './mailbox-security';

export function pushHost(endpoint: string) {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    throw new BadRequestException('MAILBOX_PUSH_ENDPOINT_INVALID');
  }
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    (u.port && u.port !== '443') ||
    !(
      u.hostname === 'fcm.googleapis.com' ||
      u.hostname === 'updates.push.services.mozilla.com' ||
      u.hostname === 'web.push.apple.com' ||
      /^[a-z0-9-]+\.push\.apple\.com$/.test(u.hostname)
    )
  )
    throw new BadRequestException('MAILBOX_PUSH_PROVIDER_NOT_ALLOWED');
  return u.hostname;
}
export function pinnedPushAgent(resolved: { address: string; family: number }) {
  return new Agent({
    // Node's automatic family selection requests lookup({ all: true }). Keep
    // DNS pinned to the vetted address while honouring both callback contracts.
    lookup: ((_hostname: any, options: any, done: any) =>
      options?.all
        ? done(null, [{ address: resolved.address, family: resolved.family }])
        : done(null, resolved.address, resolved.family)) as any,
  });
}
@Injectable()
export class MailboxPushService {
  constructor(
    readonly db: PrismaService,
    readonly access: MailboxAccessService,
    readonly sessions: AuthSessionsService,
  ) {}
  config() {
    return {
      publicKey: process.env.MAILBOX_VAPID_PUBLIC_KEY || null,
      configured: !!(
        process.env.MAILBOX_VAPID_PUBLIC_KEY &&
        process.env.MAILBOX_VAPID_PRIVATE_KEY &&
        process.env.MAILBOX_VAPID_SUBJECT
      ),
    };
  }
  async subscribe(actor: MailActor, session: any, input: any) {
    if (!this.config().configured)
      throw new ServiceUnavailableException('MAILBOX_PUSH_NOT_CONFIGURED');
    const sub = input.subscription;
    if (
      !sub ||
      typeof sub.endpoint !== 'string' ||
      sub.endpoint.length > 3000 ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(sub.keys?.p256dh || '') ||
      !/^[A-Za-z0-9_-]{20,30}$/.test(sub.keys?.auth || '')
    )
      throw new BadRequestException('MAILBOX_PUSH_SUBSCRIPTION_INVALID');
    await resolvePublic(pushHost(sub.endpoint));
    const allowed = await this.access.allowedIds(actor);
    if (
      !Array.isArray(input.mailboxIds) ||
      input.mailboxIds.some((id) => !allowed.includes(id))
    )
      throw new BadRequestException('MAILBOX_PUSH_ACCESS_DENIED');
    const endpointHash = createHash('sha256')
      .update(sub.endpoint)
      .digest('hex');
    const device = await this.db.mailboxPushDevice.upsert({
      where: { endpointHash },
      create: {
        userId: actor.id,
        sessionId: session.sid,
        sessionVersion: session.sv,
        endpointHash,
        subscription: encrypt(JSON.stringify(sub), `push:${endpointHash}`),
        name: String(input.name || 'Este dispositivo').slice(0, 80),
        mailboxIds: input.mailboxIds,
        details: input.details === true,
      },
      update: {
        userId: actor.id,
        sessionId: session.sid,
        sessionVersion: session.sv,
        subscription: encrypt(JSON.stringify(sub), `push:${endpointHash}`),
        active: true,
        name: String(input.name || 'Este dispositivo').slice(0, 80),
        mailboxIds: input.mailboxIds,
        details: input.details === true,
        cursorAt: new Date(),
        failures: 0,
        nextPushAt: new Date(),
      },
    });
    return { id: device.id, active: true };
  }
  async devices(actor: MailActor) {
    await this.access.allowedIds(actor);
    return this.db.mailboxPushDevice.findMany({
      where: { userId: actor.id },
      select: {
        id: true,
        name: true,
        active: true,
        mailboxIds: true,
        details: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }
  async disable(actor: MailActor, id?: string, sessionId?: string) {
    await this.access.allowedIds(actor);
    await this.db.mailboxPushDevice.updateMany({
      where: {
        userId: actor.id,
        ...(id ? { id } : sessionId ? { sessionId } : {}),
      },
      data: { active: false },
    });
    return { ok: true };
  }
  async notices(actor: MailActor, after: string) {
    const ids = await this.access.allowedIds(actor);
    const cutoff = after ? new Date(after) : new Date(Date.now() - 60000);
    if (Number.isNaN(cutoff.getTime()))
      throw new BadRequestException('MAILBOX_INVALID_NOTICE_CURSOR');
    const now = new Date();
    const rows = await this.db.mailboxNotice.findMany({
      where: {
        mailboxId: { in: ids },
        createdAt: { gt: cutoff, lte: now },
        mailbox: { active: true, notify: true },
        message: { alive: true },
      },
      include: {
        message: true,
        mailbox: { include: { permissions: { where: { userId: actor.id } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    const current = await this.access.allowedIds(actor);
    return {
      cursor: now.toISOString(),
      notices: rows
        .filter(
          (n) =>
            current.includes(n.mailboxId) &&
            (actor.role === 'SUPERADMIN' ||
              n.mailbox.permissions.some((p) => p.notify)),
        )
        .map((n) => ({
          id: n.id,
          messageId: n.messageId,
          mailboxId: n.mailboxId,
          mailbox: n.mailbox.name,
          ...(actor.role === 'SUPERADMIN' ||
          n.mailbox.permissions.some((p) => p.details)
            ? { sender: n.message.sender, subject: n.message.subject }
            : { subject: 'Nuevo correo' }),
        })),
    };
  }
  async deliver(id: string) {
    const now = new Date();
    const ownedUntil = new Date(Date.now() + 60000);
    const claim = await this.db.mailboxPushDevice.updateMany({
      where: {
        id,
        active: true,
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
      },
      data: { leaseUntil: ownedUntil },
    });
    if (!claim.count) return;
    const persist = async (data: any) =>
      (
        await this.db.mailboxPushDevice.updateMany({
          where: {
            id,
            active: true,
            leaseUntil: ownedUntil,
            AND: [{ leaseUntil: { gt: new Date() } }],
          },
          data,
        })
      ).count === 1;
    const device = await this.db.mailboxPushDevice.findUniqueOrThrow({
      where: { id },
    });
    try {
      let session;
      try {
        session = await this.sessions.validate({
          sub: device.userId,
          sid: device.sessionId,
          sv: device.sessionVersion,
          type: 'access',
        });
      } catch {
        await persist({ active: false });
        return;
      }
      const actor = { id: session.userId, role: session.user.role },
        allowed = await this.access.allowedIds(actor);
      const ids = allowed.filter((id) => device.mailboxIds.includes(id));
      const result = await this.notices(actor, device.cursorAt.toISOString());
      const notices = result.notices.filter((n) => ids.includes(n.mailboxId));
      if (!notices.length) {
        await persist({
          cursorAt: new Date(result.cursor),
          nextPushAt: new Date(Date.now() + 30000),
        });
        return;
      }
      if (!this.config().configured) return;
      const sub = JSON.parse(
          decrypt(device.subscription, `push:${device.endpointHash}`),
        ),
        host = pushHost(sub.endpoint),
        resolved = await resolvePublic(host);
      // At-most-once notification attempt. Persistent panel notices remain available on failure.
      // Check current session/grants immediately before delivery; no message bodies travel in push.
      const current = await this.sessions.validate({
        sub: device.userId,
        sid: device.sessionId,
        sv: device.sessionVersion,
        type: 'access',
      });
      const currentIds = await this.access.allowedIds({
        id: current.userId,
        role: current.user.role,
      });
      const currentDevice = await this.db.mailboxPushDevice.findUniqueOrThrow({
        where: { id },
      });
      const currentNotices = (
        await this.notices(
          { id: current.userId, role: current.user.role },
          device.cursorAt.toISOString(),
        )
      ).notices;
      if (
        !notices.every(
          (n) =>
            currentIds.includes(n.mailboxId) &&
            currentDevice.mailboxIds.includes(n.mailboxId) &&
            currentNotices.some((fresh) => fresh.id === n.id),
        ) ||
        !currentDevice.active ||
        currentDevice.userId !== device.userId ||
        currentDevice.sessionId !== device.sessionId ||
        currentDevice.sessionVersion !== device.sessionVersion
      )
        return;
      if (
        !(await persist({
          cursorAt: new Date(result.cursor),
          nextPushAt: new Date(Date.now() + 60000),
        }))
      )
        return;
      const first = currentNotices.find((n) => n.id === notices[0].id)!,
        details = currentDevice.details && !!(first as any).sender;
      const agent = pinnedPushAgent(resolved);
      try {
        await webpush.sendNotification(
          sub,
          JSON.stringify({
            title: 'CRONOX · Correo',
            body: details
              ? `${first.mailbox}: ${(first as any).sender} · ${first.subject}`
              : `Tienes nuevos mensajes en Correo${notices.length > 1 ? ' (' + notices.length + ' o más)' : ''}.`,
            tag: 'cronox-mail',
            url:
              '/admin.html?mail=' +
              encodeURIComponent(first.messageId) +
              '#section-inbox',
          }),
          {
            TTL: 60,
            topic: 'cronox-mail',
            timeout: 15000,
            agent,
            vapidDetails: {
              subject: process.env.MAILBOX_VAPID_SUBJECT!,
              publicKey: process.env.MAILBOX_VAPID_PUBLIC_KEY!,
              privateKey: process.env.MAILBOX_VAPID_PRIVATE_KEY!,
            },
          },
        );
        await persist({ failures: 0 });
      } catch (e) {
        const status = Number((e as any).statusCode);
        await persist({
          active: ![404, 410].includes(status),
          failures: { increment: 1 },
          nextPushAt: new Date(Date.now() + 300000),
        });
      } finally {
        agent.destroy();
      }
    } catch {
      await persist({ nextPushAt: new Date(Date.now() + 300000) }).catch(
        () => {},
      );
    } finally {
      await this.db.mailboxPushDevice
        .updateMany({
          where: { id, leaseUntil: ownedUntil },
          data: { leaseUntil: null },
        })
        .catch(() => {});
    }
  }
}
