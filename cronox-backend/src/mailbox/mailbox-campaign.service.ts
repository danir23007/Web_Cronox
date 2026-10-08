import { quotaWaiting, reserveAccountQuota } from '../email/mail-account-quota';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import MailComposer from 'mailbox-nodemailer/lib/mail-composer';
import ExcelJS from 'exceljs';
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
import { campaignAudience, missingCampaignVariables } from './campaign-plan';
import { effectiveMailHtml } from '../email/managed/mail-renderer';
import { versionFingerprint } from './mailbox-retention.service';
import { MailboxTrackingService } from './mailbox-tracking.service';

@Injectable()
export class MailboxCampaignService {
  constructor(
    readonly db: PrismaService,
    readonly access: MailboxAccessService,
    readonly templates: ManagedMailService,
    readonly files: MailboxFilesService,
    readonly provider: MailboxProviderService,
    readonly leases: MailboxLeasesService,
    readonly tracking?: MailboxTrackingService,
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
      where: { senderKey: key, archivedAt: null, OR: [{ purpose: null }, { purpose: { in: MAIL_PURPOSES.filter(p => p.senderKey === key).map(p => p.key) } }] },
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
          where: { id, senderKey: key, archivedAt: null, OR: [{ purpose: null }, { purpose: { in: MAIL_PURPOSES.filter(p => p.senderKey === key).map(p => p.key) } }] },
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
  async resolveRecipients(selected: number[], tx: any = this.db) {
    const users = await tx.user.findMany({
      where: { circleLevel: { in: [1, 2, 3, 4, 5] }, accountState: 'ACTIVE',
        role: { in: ['USER', 'FRIEND'] }, newsletterSubscribed: true },
      select: { email: true, name: true, circleLevel: true },
    });
    const suppressed = await tx.mailboxSuppression.findMany({ select: { email: true } });
    return campaignAudience(users, suppressed.map((v: any) => v.email), selected);
  }
  async recipients(selected: number[]) {
    return (await this.resolveRecipients(circles(selected))).recipients.map(r => r.email);
  }
  async eligible(email: string, circle?: number) {
    if (
      !circle ||
      (await this.db.mailboxSuppression.findUnique({ where: { email } }))
    )
      return false;
    const users = await this.db.user.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        accountState: 'ACTIVE',
        role: { in: ['USER', 'FRIEND'] },
        newsletterSubscribed: true,
      },
      select: { circleLevel: true },
    });
    return users.length > 0 && users.every((u) => u.circleLevel === circle);
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
  assertInfo(box: { address: string }) {
    if (box.address.toLowerCase() !== 'info@cronox.es')
      throw new BadRequestException(
        'Las campa\u00f1as solo pueden salir desde info@cronox.es.',
      );
  }
  async options(actor: MailActor, mailboxId: string) {
    this.assertInfo(await this.access.box(actor, mailboxId, true));
    const families = await this.db.campaignTemplateFamily.findMany({
      where: { id: { notIn: ['campaign:INFO:LAUNCH', 'campaign:INFO:RESTOCK', 'campaign:INFO:GENERIC'] } },
      orderBy: { name: 'asc' },
    });
    const variants = await this.db.productVariant.findMany({
      where: {
        isActive: true,
        stockQty: { gt: 0 },
        product: { isActive: true },
      },
      include: { product: true },
      orderBy: { id: 'asc' },
    });
    return {
      families,
      variants: variants.map((v) => ({
        id: v.id,
        name: v.product.name,
        size: v.size,
      })),
    };
  }
  async plan(d: any, tx: any = this.db) {
    this.assertInfo(d.mailbox);
    if (d.mode !== 'campaign')
      throw new BadRequestException(
        'Campaña anterior: crea una nueva con familia y círculos. Se conserva el original.',
      );
    const selected = circles(d.circles),
      blocked: string[] = [],
      previews: any[] = [],
      deliveries: any[] = [];
    const family = d.familyId
      ? await tx.campaignTemplateFamily.findUnique({
          where: { id: d.familyId },
          include: { versions: true },
        })
      : null;
    if (!family) blocked.push('Selecciona una familia de plantillas.');
    if (!selected.length) blocked.push('Selecciona al menos un círculo.');
    const audience = await this.resolveRecipients(selected, tx);
    blocked.push(...audience.blocked);
    const origin = (process.env.FRONTEND_URL || 'https://cronox.es').replace(
      /\/$/,
      '',
    );
    const event: Record<string, unknown> = { storeUrl: origin };
    if (family?.eventKind === 'LAUNCH') event.actionUrl = origin;
    if (family?.eventKind === 'RESTOCK') {
      const variant = Number.isInteger(d.campaignEvent?.variantId)
        ? await tx.productVariant.findUnique({
            where: { id: d.campaignEvent.variantId },
            include: { product: true },
          })
        : null;
      if (
        !variant?.isActive ||
        !variant.product.isActive ||
        variant.stockQty <= 0
      )
        blocked.push('Selecciona una talla disponible de un producto activo.');
      else
        Object.assign(event, {
          product: variant.product.name,
          productName: variant.product.name,
          size: variant.size,
          productSlug: variant.product.slug,
          productImage: variant.product.imageUrl,
          imageUrl: variant.product.imageUrl,
          actionUrl:
            origin +
            '/producto/' +
            encodeURIComponent(variant.product.slug) +
            '?size=' +
            encodeURIComponent(variant.size),
        });
    }
    for (const circle of selected) {
      const t = family?.versions.find(
        (v: any) =>
          v.campaignCircle === circle &&
          v.senderKey === 'INFO' &&
          !v.archivedAt &&
          v.purpose === null,
      );
      const members = audience.recipients.filter((r) => r.circle === circle);
      if (!t) {
        blocked.push(
          'Falta una versión válida para el círculo ' + circle + '.',
        );
        previews.push({ circle, count: members.length, missing: true });
        continue;
      }
      const source = await this.templates.render(
        'INFO',
        t,
        undefined,
        false,
        tx,
      );
      await this.assertPrivateContent({ ...source, files: [] });
      const renderOne = async (r: any) => {
        const data = {
          ...event,
          customerFullName: r?.name,
          customerEmail: r?.email,
          email: r?.email,
        };
        const missing = missingCampaignVariables(source, data);
        if (missing.length) {
          blocked.push(
            'Círculo ' +
              circle +
              ': faltan ' +
              missing.join(', ') +
              '. Revisa la versión en Plantillas Mail o los datos del evento.',
          );
          return null;
        }
        const content = await this.templates.render('INFO', t, data, false, tx);
        assertResolved(content.subject, content.html, content.text);
        header(content.subject);
        if (!content.subject.trim() || !content.text.trim()) {
          blocked.push('Círculo ' + circle + ': asunto o contenido vacío.');
          return null;
        }
        return {
          subject: content.subject,
          html: content.html,
          text: content.text,
          templateId: t.id,
          templateRevision: t.revision,
          familyId: family.id,
          circle,
        };
      };
      let preview: any;
      for (const r of members) {
        const content = await renderOne(r);
        if (content) {
          preview ||= content;
          deliveries.push({ email: r.email, circleLevel: circle, content });
        }
      }
      // Empty circles still need a structurally valid version; never invent customer data.
      if (!members.length) {
        await renderOne(null);
        preview = source;
      }
      previews.push({
        circle,
        count: members.length,
        templateId: t.id,
        templateRevision: t.revision,
        ...(preview || source),
      });
    }
    if (!audience.recipients.length)
      blocked.push('No hay destinatarios elegibles.');
    const uniqueBlocked = [...new Set(blocked)];
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          revision: d.revision,
          family: family && { id: family.id, revision: family.revision },
          event,
          selected,
          deliveries,
          previews,
        }),
      )
      .digest('hex');
    return {
      family,
      previews,
      deliveries,
      recipients: audience.recipients.map(r => ({ ...r,
        templateName: family?.versions.find((v: any) => v.campaignCircle === r.circle && v.senderKey === 'INFO' && !v.archivedAt && v.purpose === null)?.name || '',
      })),
      blocked: uniqueBlocked,
      previewHash: hash,
      count: audience.recipients.length,
      circles: selected,
    };
  }
  async summary(actor: MailActor, id: string) {
    const d = await this.access.draft(actor, id);
    const { deliveries, recipients, family, ...plan } = await this.plan(d);
    return {
      ...plan,
      family: family && { id: family.id, name: family.name },
      sender: 'info@cronox.es',
      policy: campaignPolicy(),
    };
  }
  async selection(actor: MailActor, mailboxId: string, input: any) {
    if ((input.familyId !== undefined && (typeof input.familyId !== 'string' || input.familyId.length > 100)) ||
      (input.campaignName !== undefined && (typeof input.campaignName !== 'string' || input.campaignName.length > 160)) ||
      (input.variantId !== undefined && (!Number.isInteger(input.variantId) || input.variantId < 1)) ||
      (input.revision !== undefined && (!Number.isInteger(input.revision) || input.revision < 1)))
      throw new BadRequestException('MAILBOX_INVALID_CAMPAIGN');
    const mailbox = await this.access.box(actor, mailboxId, true);
    this.assertInfo(mailbox);
    return { mailbox, mailboxId, mode: 'campaign', revision: input.revision || 1,
      campaignName: input.campaignName?.trim() || null,
      familyId: input.familyId || null, circles: circles(input.circles || []),
      campaignEvent: input.variantId ? { variantId: input.variantId } : {},
      files: [], to: '', cc: '', bcc: '',
    };
  }
  async audience(actor: MailActor, mailboxId: string, input: any) {
    const d = await this.selection(actor, mailboxId, input);
    const { deliveries, recipients, family, ...plan } = await this.plan(d);
    return { ...plan, family: family && { id: family.id, name: family.name },
      sender: 'info@cronox.es', policy: campaignPolicy() };
  }
  async exportAudience(actor: MailActor, mailboxId: string, input: any) {
    const d = await this.selection(actor, mailboxId, input);
    const plan = await this.plan(d);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Destinatarios');
    sheet.columns = [{ header: 'Nombre', key: 'name', width: 32 },
      { header: 'Correo electrónico', key: 'email', width: 40 },
      { header: 'Círculo', key: 'circle', width: 12 },
      { header: 'Versión de plantilla', key: 'templateName', width: 40 }];
    // Plain strings are data, never ExcelJS formula objects.
    plan.recipients.forEach(r => sheet.addRow(r));
    await this.access.box(actor, mailboxId, true);
    return workbook.xlsx.writeBuffer();
  }
  async saveSelection(actor: MailActor, mailboxId: string, input: any) {
    const d = await this.selection(actor, mailboxId, input);
    if (d.familyId && !await this.db.campaignTemplateFamily.findUnique({ where: { id: d.familyId } }))
      throw new BadRequestException('MAILBOX_TEMPLATE_NOT_AVAILABLE');
    // The only creation endpoint for the new campaign editor's explicit save.
    if (input.draftId) {
      const existing = await this.access.draft(actor, input.draftId);
      if (existing.mailboxId !== mailboxId || existing.mode !== 'campaign')
        throw new BadRequestException('MAILBOX_INVALID_CAMPAIGN');
      const changed = await this.db.mailboxDraft.updateMany({
        where: { id: input.draftId, userId: actor.id, status: 'DRAFT', revision: input.revision },
        data: { campaignName: input.campaignName === undefined ? existing.campaignName : d.campaignName, familyId: d.familyId,
          campaignEvent: d.campaignEvent, circles: d.circles, revision: { increment: 1 } },
      });
      if (!changed.count) throw new ConflictException('MAILBOX_DRAFT_CHANGED_OR_QUEUED');
      return { id: existing.id };
    }
    const saved = await this.db.mailboxDraft.create({ data: {
      mailboxId, userId: actor.id, mode: 'campaign', campaignName: d.campaignName,
      familyId: d.familyId, campaignEvent: d.campaignEvent, circles: d.circles,
    } });
    return { id: saved.id };
  }
  async enqueue(actor: MailActor, id: string | null, input: any, mailboxId?: string) {
    const d = id ? await this.access.draft(actor, id) : await this.selection(actor, mailboxId!, input);
    this.assertInfo(d.mailbox);
    const prior = await this.db.mailboxCampaign.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (prior) {
      const existing = await this.access.draft(actor, prior.draftId);
      if (existing.mailboxId !== d.mailboxId)
        throw new ConflictException('MAILBOX_IDEMPOTENCY_KEY_USED');
      if (id && prior.draftId !== id)
        throw new ConflictException('MAILBOX_IDEMPOTENCY_KEY_USED');
      return this.view(actor, prior.id);
    }
    if (
      !campaignPolicy().ready ||
      process.env.MAILBOX_SEND_ENABLED !== 'true' ||
      process.env.MAILBOX_WORKER_ENABLED !== 'true'
    )
      throw new ServiceUnavailableException(
        'MAILBOX_CAMPAIGN_PROVIDER_NOT_READY',
      );
    if (
      !d.mailbox.active ||
      d.mode !== 'campaign' ||
      d.files.length ||
      d.to ||
      d.cc ||
      d.bcc
    )
      throw new BadRequestException('MAILBOX_INVALID_CAMPAIGN');
    const scheduledAt = input.localDate
      ? madridInstant(input.localDate, input.offset)
      : new Date();
    let campaign;
    try { campaign = await this.db.$transaction(
      async (tx) => {
        const stored = id ? await tx.mailboxDraft.findUniqueOrThrow({
          where: { id },
          include: { mailbox: true },
        }) : d;
        const fresh: any = input.selection ? { ...stored, ...await this.selection(actor, stored.mailboxId, input), revision: stored.revision,
          campaignName: input.campaignName === undefined ? stored.campaignName : input.campaignName.trim() || null } : stored;
        const plan = await this.plan(fresh, tx);
        if (plan.blocked.length)
          throw new BadRequestException({
            message: 'MAILBOX_CAMPAIGN_BLOCKED',
            details: plan.blocked,
          });
        if (
          input.previewHash !== plan.previewHash ||
          fresh.revision !== input.revision
        )
          throw new ConflictException('MAILBOX_RECIPIENT_PREVIEW_CHANGED');
        let draftId = id;
        if (!id) {
          const created = await tx.mailboxDraft.create({ data: {
            mailboxId: d.mailboxId, userId: actor.id, mode: 'campaign', status: 'SCHEDULED',
            campaignName: fresh.campaignName, familyId: fresh.familyId,
            campaignEvent: fresh.campaignEvent, circles: fresh.circles,
          } });
          draftId = created.id;
        }
        const lock = id ? await tx.mailboxDraft.updateMany({
          where: {
            id,
            userId: actor.id,
            status: 'DRAFT',
            revision: input.revision,
          },
          data: { status: 'SCHEDULED', campaignName: fresh.campaignName,
            familyId: fresh.familyId, campaignEvent: fresh.campaignEvent, circles: fresh.circles },
        }) : { count: 1 };
        if (!lock.count)
          throw new ConflictException('MAILBOX_DRAFT_CHANGED_OR_QUEUED');
        const campaignId = randomUUID();
        const versions = new Map<string, { id: string; fingerprint: string; content: any }>();
        const deliveries = plan.deliveries.map((r: any) => {
          const footer = '\n\nRecibes esta comunicación por tu suscripción a CRONOX. Darme de baja: __CRONOX_UNSUBSCRIBE_URL__';
          const content = { ...r.content, wireFrozen: true, text: r.content.text + footer,
            html: r.content.html ? effectiveMailHtml(r.content.html + '<p>Recibes esta comunicación por tu suscripción a CRONOX. <a href="__CRONOX_UNSUBSCRIBE_URL__">Darme de baja</a></p>') : '' };
          const fingerprint = versionFingerprint(content);
          if (!versions.has(fingerprint)) versions.set(fingerprint, { id: randomUUID(), fingerprint, content });
          return { email: r.email, circleLevel: r.circleLevel, versionId: versions.get(fingerprint)!.id,
            trackingToken: process.env.MAILBOX_CAMPAIGN_TRACKING_ENABLED === 'true' ? randomUUID() : null,
            messageId: `<${randomUUID()}@cronox.es>` };
        });
        return tx.mailboxCampaign.create({
          data: {
            id: campaignId,
            versions: { create: [...versions.values()] },
            draftId: draftId!,
            draftRevision: fresh.revision,
            requestKey: input.requestKey,
            scheduledAt,
            snapshot: {
              modelVersion: 2,
              campaignName: fresh.campaignName,
              mailboxId: d.mailboxId,
              userId: actor.id,
              from: 'info@cronox.es',
              fromName: d.mailbox.fromName,
              senderKey: 'INFO',
              familyId: plan.family.id,
              familyName: plan.family.name,
              circles: plan.circles,
              versions: plan.previews.map((p) => ({
                circle: p.circle,
                templateId: p.templateId,
                templateRevision: p.templateRevision,

              })),
              files: [],
              count: plan.count,
            },
            deliveries: {
              create: deliveries,
            },
          },
        });
      },
      { isolationLevel: 'RepeatableRead', timeout: 60000 },
    ); } catch (error) {
      // A repeated/concurrent request rolls back its provisional draft too.
      const prior = await this.db.mailboxCampaign.findUnique({ where: { requestKey: input.requestKey } });
      if (prior && (!id || prior.draftId === id)) return this.view(actor, prior.id);
      throw error;
    }
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
      by: ['status', 'circleLevel'],
      where: { campaignId: id },
      _count: { _all: true },
    });
    const firstAccepted = await this.db.mailboxCampaignDelivery.aggregate({ where: { campaignId: id, status: 'SMTP_ACCEPTED' }, _min: { completedAt: true } });
    const versions = await this.db.mailboxCampaignVersion.findMany({ where: { campaignId: id } });
    const legacy = versions.length ? [] : await this.db.mailboxCampaignDelivery.findMany({ where: { campaignId: id }, select: { content: true } });
    const legacyVersions = [...new Map(legacy.filter(d => d.content).map(d => [versionFingerprint(d.content), d.content])).values()];
    return {
      id: c.id,
      draftId: c.draftId,
      campaignName: c.draft.campaignName || (c.snapshot as any).campaignName || null,
      status: c.status,
      scheduledAt: c.scheduledAt,
      startedAt: c.startedAt,
      sentAt: firstAccepted._min.completedAt,
      completedAt: c.completedAt,
      cancelledAt: c.cancelledAt,
      errorCode:
        (c.snapshot as any).modelVersion === 2
          ? c.errorCode
          : 'MAILBOX_CAMPAIGN_LEGACY_REVIEW_REQUIRED',
      policy: campaignPolicy(),
      count: (c.snapshot as any).count,
      circles: (c.snapshot as any).circles,
      familyName: (c.snapshot as any).familyName,
      previews: versions.length ? versions.map(v => ({ id: v.id, ...v.content as any })) : legacyVersions.length ? legacyVersions : (c.snapshot as any).versions || [],
      ...await this.tracking?.metrics(id),
      recipients: await this.db.mailboxCampaignDelivery.findMany({ where: { campaignId: id },
        select: { email: true, status: true, circleLevel: true, versionId: true, completedAt: true, visitedAt: true, bouncedAt: true, errorCode: true }, orderBy: { email: 'asc' } }),
      progress: progress.map((p) => ({
        status: p.status,
        circle: p.circleLevel,
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
        OR: [
          { errorCode: null },
          { errorCode: { not: 'MAILBOX_CAMPAIGN_LEGACY_REVIEW_REQUIRED' } },
        ],
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: 'asc' },
      include: { draft: { include: { mailbox: true } } },
      take: 20,
    });
    for (const c of due) {
      if (
        (c.snapshot as any).modelVersion !== 2 ||
        c.draft.mailbox.address.toLowerCase() !== 'info@cronox.es'
      ) {
        await this.db.mailboxCampaign.update({
          where: { id: c.id },
          data: { errorCode: 'MAILBOX_CAMPAIGN_LEGACY_REVIEW_REQUIRED' },
        });
        continue;
      }
      // One campaign delivery per tick; existing manual mail and IMAP retain priority.
      const worked = await this.leases
        .run(c.draft.mailboxId, async (token, assert) => {
          const snapshot = c.snapshot as any,
            box = c.draft.mailbox;
          const actor = Number.isSafeInteger(snapshot.userId) && snapshot.userId > 0
            ? await this.db.user.findUnique({
                where: { id: snapshot.userId },
                select: { id: true, role: true, accountState: true },
              })
            : null;
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
              // Do not claim until a real delivery is ready; scheduled jobs remain editable.
              const d = await tx.mailboxCampaignDelivery.findFirst({
                where: {
                  campaignId: c.id,
                  status: 'PENDING',
                  readyAt: { lte: new Date() },
                },
                orderBy: { id: 'asc' },
                include: { version: true },
              });
              if (!d) return null;
              try {
                await reserveAccountQuota(tx, box.username, 'CAMPAIGN:' + d.id + (d.attempts ? ':attempt' + (d.attempts+1) : ''), 1, policy);
              } catch (error) {
                if (!quotaWaiting(error)) throw error;
                await tx.mailboxCampaignDelivery.update({ where: { id: d.id }, data: { readyAt: error.retryAt } });
                await tx.mailboxCampaign.update({ where: { id: c.id }, data: { errorCode: 'MAILBOX_CAMPAIGN_CAPACITY_WAITING' } });
                return null;
              }
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
            if (
              !(await this.eligible(
                delivery.email,
                delivery.circleLevel ?? undefined,
              ))
            ) {
              await this.db.mailboxCampaignDelivery.update({
                where: { id: delivery.id },
                data: { status: 'EXCLUDED', completedAt: new Date() },
              });
              return true;
            }
            const content = (delivery.version?.content || delivery.content) as any;
            if (
              !content ||
              content.circle !== delivery.circleLevel ||
              content.familyId !== snapshot.familyId ||
              !snapshot.versions.some(
                (v: any) =>
                  v.circle === delivery.circleLevel &&
                  v.templateId === content.templateId &&
                  v.templateRevision === content.templateRevision,
              )
            )
              throw Error('CAMPAIGN_VERSION_MISMATCH');
            const link =
              policy.origin.replace(/\/$/, '') +
              '/api/mailbox-unsubscribe/' +
              this.unsubscribeToken(delivery.email);
            const footer = `\n\nRecibes esta comunicación por tu suscripción a CRONOX. Darme de baja: ${link}`;
            const html = content.wireFrozen ? content.html.replaceAll('__CRONOX_UNSUBSCRIBE_URL__', link) : content.html
              ? effectiveMailHtml(
                  content.html +
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
            header(content.subject);
            assertResolved(content.subject, content.text, content.html);
            const text = content.wireFrozen ? content.text.replaceAll('__CRONOX_UNSUBSCRIBE_URL__', link) : content.text + footer;
            const composer = new MailComposer({
              from: { name: snapshot.fromName, address: box.address },
              bcc: [delivery.email],
              subject: content.subject,
              text: this.tracking?.instrumentText(text, delivery.trackingToken) || text,
              html: html ? this.tracking?.instrumentHtml(html, delivery.trackingToken) || html : undefined,
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
            await this.db.mailboxStorageGarbage.create({ data: { key: rawKey, createdAt: new Date(Date.now() + 600000) } });
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
                !campaignPolicy().ready ||
                process.env.MAILBOX_SEND_ENABLED !== 'true' ||
                process.env.MAILBOX_WORKER_ENABLED !== 'true'
              )
                throw Error('SENDING_DISABLED');
              if (
                (
                  await this.db.mailboxCampaign.findUniqueOrThrow({
                    where: { id: c.id },
                  })
                ).cancelledAt ||
                !(await this.eligible(
                  delivery.email,
                  delivery.circleLevel ?? undefined,
                ))
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
                  sentCopyStatus: 'SHARED_CAMPAIGN_VERSION',
                  trackingToken: process.env.MAILBOX_CAMPAIGN_TRACKING_ENABLED === 'true' ? delivery.trackingToken : null,
                },
              });
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
