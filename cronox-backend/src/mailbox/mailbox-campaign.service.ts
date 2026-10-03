import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import MailComposer from 'mailbox-nodemailer/lib/mail-composer';
import { PrismaService } from '../prisma/prisma.service';
import { ManagedMailService } from '../email/managed/managed-mail.service';
import { MAIL_PURPOSES } from '../email/managed/mail-catalog';
import { MailboxAccessService, MailActor } from './mailbox-access.service';
import { MailboxFilesService } from './mailbox-files.service';
import { MailboxProviderService } from './mailbox-provider.service';
import { MailboxLeasesService } from './mailbox-leases.service';
import {
  assertResolved,
  campaignPolicy,
  canonicalRecipient,
  circles,
  madridInstant,
} from './mailbox-campaign-policy';
import { decrypt, encrypt, header, maxMessageBytes } from './mailbox-security';
import { effectiveMailHtml } from '../email/managed/mail-renderer';

@Injectable()
export class MailboxCampaignService {
  constructor(
    readonly db: PrismaService,
    readonly access: MailboxAccessService,
    readonly templates: ManagedMailService,
    readonly files: MailboxFilesService,
    readonly provider: MailboxProviderService,
    readonly leases: MailboxLeasesService,
  ) {}

  senderKey(address: string) {
    return this.templates
      .metadata()
      .find((a) => a.email?.toLowerCase() === address.toLowerCase())?.key;
  }
  async templateList(actor: MailActor, mailboxId: string) {
    const box = await this.access.box(actor, mailboxId, true),
      key = this.senderKey(box.address);
    if (!key) return [];
    // Read the existing catalog only: no import, publication, transactional flow or SMTP.
    return this.db.managedEmailTemplate.findMany({
      where: { senderKey: key, archivedAt: null },
      select: {
        id: true,
        name: true,
        subject: true,
        purpose: true,
        folder: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
  }
  async template(
    actor: MailActor,
    mailboxId: string,
    id: string,
    data?: Record<string, unknown>,
  ) {
    const box = await this.access.box(actor, mailboxId, true),
      key = this.senderKey(box.address);
    const t = key
      ? await this.db.managedEmailTemplate.findFirst({
          where: { id, senderKey: key, archivedAt: null },
        })
      : null;
    if (!t) throw new BadRequestException('MAILBOX_TEMPLATE_NOT_AVAILABLE');
    const source = await this.templates.render(key!, t);
    const variables = [
      ...new Set(
        [
          ...`${source.subject}\n${source.html}\n${source.text}`.matchAll(
            /\{\{(?:#(?:if|each)\s+)?([\w.]+)\}\}/g,
          ),
        ]
          .map((m) => m[1])
          .filter((v) => v !== 'else'),
      ),
    ];
    if (!data) return { ...source, templateId: t.id, variables };
    if (
      typeof data !== 'object' ||
      Array.isArray(data) ||
      JSON.stringify(data).length > 50000
    )
      throw new BadRequestException('MAILBOX_INVALID_TEMPLATE_DATA');
    // Loop-local item fields must be supplied for every item, never silently erased.
    const itemFields = [
      'name',
      'quantity',
      'variantName',
      'imageUrl',
      'lineTotalFormatted',
    ];
    const missing = variables.filter((path) => {
      const read = (obj: any, p: string) =>
        p
          .split('.')
          .reduce(
            (o, k) =>
              o && Object.prototype.hasOwnProperty.call(o, k)
                ? o[k]
                : undefined,
            obj,
          );
      if (variables.includes('items') && itemFields.includes(path))
        return (
          !Array.isArray(data.items) ||
          data.items.some((item) => read(item, path) === undefined)
        );
      return read(data, path) === undefined;
    });
    if (missing.length)
      throw new BadRequestException('MAILBOX_TEMPLATE_VARIABLES_UNRESOLVED');
    for (const path of MAIL_PURPOSES.find((p) => p.key === t.purpose)
      ?.required || []) {
      if (
        variables.includes(path) &&
        (data[path] === null ||
          data[path] === '' ||
          (Array.isArray(data[path]) && !(data[path] as unknown[]).length))
      )
        throw new BadRequestException('MAILBOX_TEMPLATE_VARIABLES_UNRESOLVED');
    }
    const result = await this.templates.render(key!, t, data);
    assertResolved(result.subject, result.html, result.text);
    return { ...result, templateId: t.id, variables: [] };
  }
  async recipients(selected: number[]) {
    const users = await this.db.user.findMany({
      where: {
        circleLevel: { in: circles(selected) },
        accountState: 'ACTIVE',
        role: { in: ['USER', 'FRIEND'] },
        newsletterSubscribed: true,
      },
      select: { email: true },
    });
    const emails = [
      ...new Set(
        users
          .map((u) => canonicalRecipient(u.email))
          .filter((v): v is string => !!v),
      ),
    ].sort();
    const excluded = await this.db.mailboxSuppression.findMany({
      where: { email: { in: emails } },
      select: { email: true },
    });
    const suppressed = new Set(excluded.map((s) => s.email));
    return emails.filter((e) => !suppressed.has(e));
  }
  async eligible(email: string) {
    return (
      !(await this.db.mailboxSuppression.findUnique({ where: { email } })) &&
      !!(await this.db.user.findFirst({
        where: {
          email: { equals: email, mode: 'insensitive' },
          accountState: 'ACTIVE',
          role: { in: ['USER', 'FRIEND'] },
          newsletterSubscribed: true,
        },
      }))
    );
  }
  async assertPrivateContent(d: any) {
    // A circle message has one shared body: recipient variables/lists must never
    // be copied into it. Also reject customer-address lists in plain attachments.
    const sources = [d.subject, d.text, d.html];
    for (const file of d.files) {
      if (!file.key)
        throw new BadRequestException('MAILBOX_ATTACHMENT_UNAVAILABLE');
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of await this.files.read(file.key)) {
        const b = Buffer.from(chunk);
        length += b.length;
        if (length > maxMessageBytes())
          throw new BadRequestException('MAILBOX_ATTACHMENTS_LIMIT');
        chunks.push(b);
      }
      const bytes = Buffer.concat(chunks);
      sources.push(
        file.name,
        bytes.toString('utf8'),
        bytes.toString('utf16le'),
      );
    }
    const candidates = new Set<string>();
    for (const source of sources) {
      let text = String(source).replace(/&#(?:64|x40);|&commat;/gi, '@');
      try {
        text = decodeURIComponent(text);
      } catch {}
      for (const match of text.matchAll(
        /[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      )) {
        const email = canonicalRecipient(match[0]);
        if (email) candidates.add(email);
        if (candidates.size > 500)
          throw new BadRequestException(
            'MAILBOX_CUSTOMER_ADDRESSES_IN_CONTENT',
          );
      }
    }
    if (
      candidates.size &&
      (await this.db.user.findFirst({
        where: {
          role: { in: ['USER', 'FRIEND'] },
          OR: [...candidates].map((email) => ({
            email: { equals: email, mode: 'insensitive' },
          })),
        },
        select: { id: true },
      }))
    )
      throw new BadRequestException('MAILBOX_CUSTOMER_ADDRESSES_IN_CONTENT');
  }
  async summary(actor: MailActor, id: string) {
    const d = await this.access.draft(actor, id);
    if (d.mode !== 'circles')
      throw new BadRequestException('MAILBOX_NOT_A_CIRCLE_DRAFT');
    const emails = await this.recipients(d.circles);
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          revision: d.revision,
          emails,
          files: d.files.map((f) => f.id).sort(),
        }),
      )
      .digest('hex');
    return {
      circles: d.circles,
      count: emails.length,
      previewHash: digest,
      policy: campaignPolicy(),
      sender: d.mailbox.address,
      templateId: d.templateId,
      subject: d.subject,
    };
  }
  async enqueue(actor: MailActor, id: string, input: any) {
    const d = await this.access.draft(actor, id);
    const prior = await this.db.mailboxCampaign.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (prior) {
      if (prior.draftId !== id)
        throw new ConflictException('MAILBOX_IDEMPOTENCY_KEY_USED');
      return this.view(actor, prior.id);
    }
    const policy = campaignPolicy();
    if (
      !policy.ready ||
      process.env.MAILBOX_SEND_ENABLED !== 'true' ||
      process.env.MAILBOX_WORKER_ENABLED !== 'true'
    )
      throw new ServiceUnavailableException(
        'MAILBOX_CAMPAIGN_PROVIDER_NOT_READY',
      );
    if (d.mode !== 'circles' || !d.mailbox.active)
      throw new BadRequestException('MAILBOX_INVALID_CAMPAIGN');
    if (d.to || d.cc || d.bcc)
      throw new BadRequestException('MAILBOX_CIRCLES_BCC_ONLY');
    assertResolved(d.subject, d.html, d.text);
    if (!d.subject.trim() || !d.text.trim())
      throw new BadRequestException('MAILBOX_CAMPAIGN_CONTENT_REQUIRED');
    await this.assertPrivateContent(d);
    if (d.files.reduce((n, f) => n + f.size, 0) > maxMessageBytes())
      throw new BadRequestException('MAILBOX_ATTACHMENTS_LIMIT');
    const scheduledAt = input.localDate
      ? madridInstant(input.localDate, input.offset)
      : new Date();
    const summary = await this.summary(actor, id);
    if (
      input.previewHash !== summary.previewHash ||
      d.revision !== input.revision
    )
      throw new ConflictException('MAILBOX_RECIPIENT_PREVIEW_CHANGED');
    const emails = await this.recipients(d.circles);
    const digest = createHash('sha256')
      .update(
        JSON.stringify({
          revision: d.revision,
          emails,
          files: d.files.map((f) => f.id).sort(),
        }),
      )
      .digest('hex');
    if (digest !== summary.previewHash || !emails.length)
      throw new ConflictException('MAILBOX_RECIPIENT_PREVIEW_CHANGED');
    const snapshot = {
      mailboxId: d.mailboxId,
      userId: actor.id,
      from: d.mailbox.address,
      fromName: d.mailbox.fromName,
      senderKey: this.senderKey(d.mailbox.address),
      templateId: d.templateId,
      subject: d.subject,
      text: d.text,
      html: d.html,
      circles: d.circles,
      files: d.files.map((f) => ({ key: f.key, name: f.name, size: f.size })),
      count: emails.length,
    };
    const campaign = await this.db.$transaction(async (tx) => {
      const lock = await tx.mailboxDraft.updateMany({
        where: {
          id,
          userId: actor.id,
          status: 'DRAFT',
          revision: input.revision,
        },
        data: { status: 'SCHEDULED' },
      });
      if (!lock.count)
        throw new ConflictException('MAILBOX_DRAFT_CHANGED_OR_QUEUED');
      return tx.mailboxCampaign.create({
        data: {
          draftId: id,
          draftRevision: d.revision,
          requestKey: input.requestKey,
          scheduledAt,
          snapshot,
          deliveries: {
            create: emails.map((email) => ({
              email,
              messageId: `<${randomUUID()}@${d.mailbox.address.split('@')[1]}>`,
            })),
          },
        },
      });
    });
    await this.access.audit(
      actor,
      d.mailboxId,
      'CAMPAIGN_SCHEDULED',
      campaign.id,
    );
    return this.view(actor, campaign.id);
  }
  async view(actor: MailActor, id: string) {
    const c = await this.db.mailboxCampaign.findUniqueOrThrow({
      where: { id },
      include: { draft: true },
    });
    await this.access.draft(actor, c.draftId);
    const progress = await this.db.mailboxCampaignDelivery.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    return {
      id: c.id,
      draftId: c.draftId,
      status: c.status,
      scheduledAt: c.scheduledAt,
      startedAt: c.startedAt,
      completedAt: c.completedAt,
      cancelledAt: c.cancelledAt,
      errorCode: c.errorCode,
      policy: campaignPolicy(),
      count: (c.snapshot as any).count,
      circles: (c.snapshot as any).circles,
      progress: progress.map((p) => ({
        status: p.status,
        count: p._count._all,
      })),
    };
  }
  async cancel(actor: MailActor, id: string, edit = false) {
    const c = await this.db.mailboxCampaign.findUniqueOrThrow({
      where: { id },
      include: { draft: true },
    });
    await this.access.draft(actor, c.draftId);
    await this.db.$transaction(async (tx) => {
      // Same row lock as the delivery claim: cancellation fences all pending work.
      const changed = await tx.mailboxCampaign.updateMany({
        where: {
          id,
          status: { in: edit ? ['SCHEDULED'] : ['SCHEDULED', 'PROCESSING'] },
          ...(edit ? { startedAt: null } : {}),
        },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      if (!changed.count)
        throw new ConflictException(
          'MAILBOX_CAMPAIGN_ALREADY_STARTED_OR_FINISHED',
        );
      await tx.mailboxCampaignDelivery.updateMany({
        where: { campaignId: id, status: 'PENDING' },
        data: { status: 'CANCELLED', completedAt: new Date() },
      });
      if (edit)
        await tx.mailboxDraft.update({
          where: { id: c.draftId },
          data: { status: 'DRAFT', revision: { increment: 1 } },
        });
    });
    return this.view(actor, id);
  }
  unsubscribeToken(email: string) {
    return Buffer.from(encrypt(email, 'mailbox-campaign-unsubscribe')).toString(
      'base64url',
    );
  }
  async suppress(actor: MailActor, email: string, reason: string) {
    this.access.superadmin(actor);
    const canonical = canonicalRecipient(email);
    if (
      !canonical ||
      !['UNSUBSCRIBED', 'CONFIRMED_HARD_BOUNCE'].includes(reason)
    )
      throw new BadRequestException('MAILBOX_INVALID_SUPPRESSION');
    await this.db.$transaction(async (tx) => {
      await tx.mailboxSuppression.upsert({
        where: { email: canonical },
        create: { email: canonical, reason },
        update: { reason },
      });
      await tx.user.updateMany({
        where: { email: { equals: canonical, mode: 'insensitive' } },
        data: { newsletterSubscribed: false },
      });
    });
    await this.access.audit(actor, null, 'CAMPAIGN_RECIPIENT_SUPPRESSED', null);
    return { saved: true };
  }
  async unsubscribe(token: string) {
    if (!/^[\w-]{1,2000}$/.test(token))
      throw new BadRequestException('MAILBOX_INVALID_UNSUBSCRIBE');
    let email: string | null;
    try {
      email = canonicalRecipient(
        decrypt(
          Buffer.from(token, 'base64url').toString(),
          'mailbox-campaign-unsubscribe',
        ),
      );
    } catch {
      throw new BadRequestException('MAILBOX_INVALID_UNSUBSCRIBE');
    }
    if (!email) throw new BadRequestException('MAILBOX_INVALID_UNSUBSCRIBE');
    await this.db.$transaction(async (tx) => {
      await tx.mailboxSuppression.upsert({
        where: { email },
        create: { email, reason: 'UNSUBSCRIBED' },
        update: { reason: 'UNSUBSCRIBED' },
      });
      await tx.user.updateMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        data: { newsletterSubscribed: false },
      });
    });
    return {
      message: 'Baja registrada. No recibirás nuevas campañas por círculos.',
    };
  }
  async recover() {
    // A crash may occur after SMTP acceptance. Never return claimed delivery to pending.
    await this.db.mailboxCampaignDelivery.updateMany({
      where: {
        status: 'PROCESSING',
        startedAt: { lt: new Date(Date.now() - 300000) },
        campaign: {
          draft: {
            mailbox: {
              OR: [{ leaseUntil: null }, { leaseUntil: { lte: new Date() } }],
            },
          },
        },
      },
      data: {
        status: 'UNKNOWN',
        errorCode: 'PROCESS_INTERRUPTED_REVIEW_BEFORE_RESEND',
        completedAt: new Date(),
      },
    });
    const active = await this.db.mailboxCampaign.findMany({
      where: { status: { in: ['PROCESSING', 'CANCELLED'] }, completedAt: null },
      select: { id: true },
      take: 100,
    });
    for (const c of active) await this.finish(c.id);
  }
  async finish(id: string) {
    const c = await this.db.mailboxCampaign.findUniqueOrThrow({
      where: { id },
    });
    const groups = await this.db.mailboxCampaignDelivery.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const has = (s: string) => groups.some((g) => g.status === s);
    if (has('PENDING') || has('PROCESSING')) return;
    const state = c.cancelledAt
      ? 'CANCELLED'
      : has('UNKNOWN')
        ? 'UNKNOWN'
        : has('FAILED')
          ? 'FAILED'
          : 'COMPLETED';
    await this.db.mailboxCampaign.update({
      where: { id },
      data: { status: state, completedAt: new Date() },
    });
  }
  async tick() {
    const policy = campaignPolicy();
    if (!policy.ready || process.env.MAILBOX_SEND_ENABLED !== 'true') return;
    const due = await this.db.mailboxCampaign.findMany({
      where: {
        status: { in: ['SCHEDULED', 'PROCESSING'] },
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      include: { draft: { include: { mailbox: true } } },
      take: 20,
    });
    for (const c of due) {
      // One campaign delivery per tick; existing manual mail and IMAP retain priority.
      const worked = await this.leases
        .run(c.draft.mailboxId, async (token, assert) => {
          const snapshot = c.snapshot as any,
            box = c.draft.mailbox;
          const actor = await this.db.user.findUnique({
            where: { id: snapshot.userId },
            select: { id: true, role: true, accountState: true },
          });
          if (!actor || actor.accountState !== 'ACTIVE' || !box.active) {
            await this.db.mailboxCampaign.update({
              where: { id: c.id },
              data: { errorCode: 'MAILBOX_CAMPAIGN_OWNER_OR_BOX_INACTIVE' },
            });
            return false;
          }
          try {
            await this.access.box(actor, box.id, true);
          } catch {
            await this.db.mailboxCampaign.update({
              where: { id: c.id },
              data: { errorCode: 'MAILBOX_CAMPAIGN_SEND_PERMISSION_REVOKED' },
            });
            return false;
          }
          const delivery = await this.leases.commit(
            box.id,
            token,
            async (tx) => {
              await tx.$queryRaw`SELECT pg_advisory_xact_lock(73129442)::text`;
              const rows =
                await tx.$queryRaw`SELECT id FROM "MailboxCampaign" WHERE id=${c.id} AND status IN ('SCHEDULED','PROCESSING') AND "cancelledAt" IS NULL FOR UPDATE`;
              if (!(rows as any[]).length) return null;
              const clock = await tx.mailboxCampaignClock.findUnique({
                where: { id: 'global' },
              });
              if (clock && clock.nextAt > new Date()) return null;
              const start = new Date(Date.now() - 86400000),
                hour = new Date(Date.now() - 3600000);
              const campaignCount = await tx.mailboxCampaignDelivery.count({
                where: {
                  startedAt: { gte: start },
                  campaign: { draft: { mailboxId: box.id } },
                },
              });
              const hourly = await tx.mailboxCampaignDelivery.count({
                where: {
                  startedAt: { gte: hour },
                  campaign: { draft: { mailboxId: box.id } },
                },
              });
              const manual = await tx.mailboxSend.findMany({
                where: {
                  startedAt: { gte: start },
                  draft: { mailboxId: box.id },
                },
                include: { draft: true },
              });
              const transactional = snapshot.senderKey
                ? await tx.emailDelivery.count({
                    where: {
                      senderKey: snapshot.senderKey,
                      createdAt: { gte: start },
                    },
                  })
                : 0;
              const manualCount = manual.reduce(
                (n, s) =>
                  n +
                  Math.max(
                    1,
                    new Set(
                      [s.draft.to, s.draft.cc, s.draft.bcc]
                        .join(',')
                        .split(',')
                        .filter(Boolean),
                    ).size,
                  ),
                0,
              );
              if (
                campaignCount + manualCount + transactional >=
                  policy.daily - policy.reserve ||
                hourly >= policy.hourly
              ) {
                await tx.mailboxCampaign.update({
                  where: { id: c.id },
                  data: {
                    errorCode: 'MAILBOX_CAMPAIGN_CAPACITY_RESERVED_WAITING',
                  },
                });
                return null;
              }
              // Do not claim until a real delivery is ready; scheduled jobs remain editable.
              const d = await tx.mailboxCampaignDelivery.findFirst({
                where: {
                  campaignId: c.id,
                  status: 'PENDING',
                  readyAt: { lte: new Date() },
                },
                orderBy: { id: 'asc' },
              });
              if (!d) return null;
              await tx.mailboxCampaign.update({
                where: { id: c.id },
                data: {
                  status: 'PROCESSING',
                  startedAt: c.startedAt || new Date(),
                  errorCode: null,
                },
              });
              await tx.mailboxCampaignClock.upsert({
                where: { id: 'global' },
                create: {
                  id: 'global',
                  nextAt: new Date(Date.now() + policy.interval * 1000),
                },
                update: {
                  nextAt: new Date(Date.now() + policy.interval * 1000),
                },
              });
              const claimed = await tx.mailboxCampaignDelivery.updateMany({
                where: { id: d.id, status: 'PENDING' },
                data: {
                  status: 'PROCESSING',
                  startedAt: new Date(),
                  attempts: { increment: 1 },
                },
              });
              return claimed.count ? d : null;
            },
          );
          if (!delivery) {
            await this.finish(c.id);
            return false;
          }
          let attempted = false,
            accepted = false,
            rawKey: string | undefined;
          try {
            if (!(await this.eligible(delivery.email))) {
              await this.db.mailboxCampaignDelivery.update({
                where: { id: delivery.id },
                data: { status: 'EXCLUDED', completedAt: new Date() },
              });
              return true;
            }
            const link =
              policy.origin.replace(/\/$/, '') +
              '/api/mailbox-unsubscribe/' +
              this.unsubscribeToken(delivery.email);
            const footer = `\n\nRecibes esta comunicación por tu suscripción a CRONOX. Darme de baja: ${link}`;
            const html = snapshot.html
              ? effectiveMailHtml(
                  snapshot.html +
                    `<p>Recibes esta comunicación por tu suscripción a CRONOX. <a href="${link}">Darme de baja</a></p>`,
                )
              : undefined;
            const attachments: any[] = [];
            for (const f of snapshot.files) {
              if (!f.key) throw Error('ATTACHMENT_UNAVAILABLE');
              attachments.push({
                filename: f.name,
                content: await this.files.read(f.key),
                contentType: 'application/octet-stream',
              });
            }
            header(snapshot.subject);
            assertResolved(snapshot.subject, snapshot.text, snapshot.html);
            const composer = new MailComposer({
              from: { name: snapshot.fromName, address: box.address },
              bcc: [delivery.email],
              subject: snapshot.subject,
              text: snapshot.text + footer,
              html,
              messageId: delivery.messageId,
              attachments,
              headers: { 'List-Unsubscribe': `<${link}>` },
              disableUrlAccess: true,
              disableFileAccess: true,
            });
            rawKey = (
              await this.files.write(
                composer.compile().createReadStream(),
                maxMessageBytes(),
              )
            ).key;
            const smtp = await this.provider.smtp(box);
            try {
              await assert();
              await this.access.box(actor, box.id, true);
              const owner = await this.db.user.findUnique({
                where: { id: actor.id },
                select: { accountState: true, role: true },
              });
              if (
                !owner ||
                owner.accountState !== 'ACTIVE' ||
                owner.role !== actor.role
              )
                throw Error('ACCESS_REVOKED');
              if (
                !(
                  await this.db.mailbox.findUniqueOrThrow({
                    where: { id: box.id },
                  })
                ).active ||
                !campaignPolicy().ready
              )
                throw Error('SENDING_DISABLED');
              if (
                (
                  await this.db.mailboxCampaign.findUniqueOrThrow({
                    where: { id: c.id },
                  })
                ).cancelledAt ||
                !(await this.eligible(delivery.email))
              ) {
                await this.db.mailboxCampaignDelivery.update({
                  where: { id: delivery.id },
                  data: { status: 'EXCLUDED', completedAt: new Date() },
                });
                return true;
              }
              attempted = true;
              const info = await smtp.sendMail({
                raw: await this.files.read(rawKey),
                envelope: { from: box.address, to: [delivery.email] },
              });
              if (!info.accepted?.length)
                throw Object.assign(Error('SMTP_REJECTED'), {
                  responseCode: 550,
                });
              accepted = true;
              await this.db.mailboxCampaignDelivery.update({
                where: { id: delivery.id },
                data: {
                  status: 'SMTP_ACCEPTED',
                  completedAt: new Date(),
                  sentCopyStatus:
                    box.sentCopy === 'provider'
                      ? 'PROVIDER_MANAGED'
                      : 'PENDING',
                },
              });
              if (box.sentCopy !== 'provider') {
                try {
                  const client = await this.provider.imap(box);
                  try {
                    await assert();
                    const sent = (await client.list()).find(
                      (f) => f.specialUse === '\\Sent',
                    );
                    if (!sent) throw Error();
                    const lock = await client.getMailboxLock(sent.path);
                    try {
                      const match = await client.search(
                        { header: { 'Message-ID': delivery.messageId } },
                        { uid: true },
                      );
                      if (!match || !match.length) {
                        const chunks: Buffer[] = [];
                        for await (const chunk of await this.files.read(rawKey))
                          chunks.push(Buffer.from(chunk));
                        if (
                          !(await client.append(
                            sent.path,
                            Buffer.concat(chunks),
                            ['\\Seen'],
                          ))
                        )
                          throw Error();
                      }
                    } finally {
                      lock.release();
                    }
                  } finally {
                    await client.logout().catch(() => client.close());
                  }
                  await this.db.mailboxCampaignDelivery.update({
                    where: { id: delivery.id },
                    data: { sentCopyStatus: 'SAVED' },
                  });
                } catch {
                  await this.db.mailboxCampaignDelivery.update({
                    where: { id: delivery.id },
                    data: { sentCopyStatus: 'FAILED_OR_UNCERTAIN' },
                  });
                }
              }
            } finally {
              smtp.close();
            }
          } catch (e: any) {
            if (!accepted) {
              const response = Number(e?.responseCode),
                temporary =
                  (response >= 400 && response < 500) ||
                  ['EDNS', 'ECONNREFUSED'].includes(e?.code) ||
                  (!attempted && e?.code === 'ETIMEDOUT');
              const uncertain =
                attempted &&
                !response &&
                !['EAUTH', 'EENVELOPE', 'EDNS', 'ECONNREFUSED'].includes(
                  e?.code,
                );
              const retry = temporary && delivery.attempts < 2;
              await this.db.mailboxCampaignDelivery.update({
                where: { id: delivery.id },
                data: {
                  status: retry ? 'PENDING' : uncertain ? 'UNKNOWN' : 'FAILED',
                  errorCode: uncertain
                    ? 'SMTP_OUTCOME_UNKNOWN'
                    : temporary
                      ? 'PROVIDER_TEMPORARY_LIMIT'
                      : 'DELIVERY_FAILED',
                  readyAt: new Date(Date.now() + 15 * 60000),
                  completedAt: retry ? null : new Date(),
                },
              });
              if (response === 550 && e?.command === 'RCPT TO') {
                await this.db.mailboxSuppression.upsert({
                  where: { email: delivery.email },
                  create: {
                    email: delivery.email,
                    reason: 'PERMANENT_SMTP_REJECTION',
                  },
                  update: {},
                });
              }
            }
          } finally {
            if (rawKey) await this.files.remove(rawKey);
            await this.finish(c.id);
          }
          return true;
        })
        .catch(() => false);
      if (worked) break;
    }
  }
}
