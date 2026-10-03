import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { PrismaService } from '../prisma/prisma.service';
import { MailboxAccessService, MailActor } from './mailbox-access.service';
import { MailboxFilesService } from './mailbox-files.service';
import { MailboxReaderService } from './mailbox-reader.service';
import { MailboxProviderService } from './mailbox-provider.service';
import { MailboxLeasesService } from './mailbox-leases.service';
import { MailboxCampaignService } from './mailbox-campaign.service';
import { circles, assertResolved } from './mailbox-campaign-policy';
import { effectiveMailHtml } from '../email/managed/mail-renderer';
import {
  addresses,
  credential,
  encrypt,
  header,
  keyring,
  maxRecipients,
  maxAttachmentBytes,
  maxMessageBytes,
  replyRecipients,
  safeError,
  serverConfig,
} from './mailbox-security';

@Injectable()
export class MailboxService {
  constructor(
    readonly db: PrismaService,
    readonly access: MailboxAccessService,
    readonly files: MailboxFilesService,
    readonly reader: MailboxReaderService,
    readonly provider: MailboxProviderService,
    readonly leases: MailboxLeasesService,
    readonly campaigns?: MailboxCampaignService,
  ) {}
  async overview(actor: MailActor) {
    const ids = await this.access.allowedIds(actor);
    const boxes = await this.db.mailbox.findMany({
      where: { id: { in: ids } },
      include: {
        folders: { where: { available: true } },
        permissions:
          actor.role === 'SUPERADMIN' ? true : { where: { userId: actor.id } },
      },
      orderBy: { name: 'asc' },
    });
    const counts = await this.db.mailboxMessage.groupBy({
      by: ['mailboxId'],
      where: {
        mailboxId: { in: ids },
        alive: true,
        seen: false,
        folder: {
          available: true,
          OR: [{ specialUse: '\\Inbox' }, { path: 'INBOX' }],
        },
      },
      _count: { _all: true },
    });
    const imported = await this.db.mailboxMessage.groupBy({
      by: ['folderId'],
      where: {
        mailboxId: { in: ids },
        alive: true,
        folder: { available: true },
      },
      _count: { _all: true },
    });
    let encryption = false,
      storage = false;
    try {
      keyring();
      encryption = true;
    } catch {}
    try {
      this.files.root();
      storage = true;
    } catch {}
    const configuredRefs = Object.keys(process.env).filter(
      (k) =>
        /^(?:SMTP_[A-Z0-9_]+_PASS|MAILBOX_[A-Z0-9_]+_(?:PASS|PASSWORD))$/.test(
          k,
        ) && !!process.env[k],
    );
    const suggestions =
      actor.role === 'SUPERADMIN'
        ? ['SUPPORT', 'ORDERS', 'NOREPLY', 'INFO']
            .filter((k) => process.env[`SMTP_${k}_USER`])
            .map((k) => ({
              name: k,
              address: process.env[`SMTP_${k}_USER`],
              credentialRef: `SMTP_${k}_PASS`,
              provider:
                process.env.SMTP_HOST === 'smtp.hostinger.com'
                  ? 'hostinger'
                  : process.env.SMTP_HOST === 'smtp.titan.email'
                    ? 'titan'
                    : null,
            }))
        : [];
    return {
      superadmin: actor.role === 'SUPERADMIN',
      workerEnabled: process.env.MAILBOX_WORKER_ENABLED === 'true',
      sendEnabled: process.env.MAILBOX_SEND_ENABLED === 'true',
      encryptionConfigured: encryption,
      storageConfigured: storage,
      credentialRefs: actor.role === 'SUPERADMIN' ? configuredRefs : [],
      suggestions,
      boxes: boxes.map((b) => ({
        id: b.id,
        name: b.name,
        address: b.address,
        fromName: b.fromName,
        provider: b.provider,
        active: b.active,
        notify: b.notify,
        status: b.status,
        errorCode: b.errorCode,
        lastSyncAt: b.lastSyncAt,
        revision: b.revision,
        unread: counts.find((c) => c.mailboxId === b.id)?._count._all || 0,
        canSend:
          actor.role === 'SUPERADMIN' ||
          b.permissions.some(
            (p) => p.userId === actor.id && p.access === 'send',
          ),
        folders: b.folders.map((f) => ({
          id: f.id,
          path: f.path,
          specialUse: f.specialUse,
          importBefore: Number(f.importBefore),
          remoteCount: f.messagesCount,
          importedCount:
            imported.find((c) => c.folderId === f.id)?._count._all || 0,
        })),
        ...(actor.role === 'SUPERADMIN'
          ? {
              imapHost: b.imapHost,
              imapPort: b.imapPort,
              smtpHost: b.smtpHost,
              smtpPort: b.smtpPort,
              username: b.username,
              imapSecretRef: b.imapSecretRef,
              smtpSecretRef: b.smtpSecretRef,
              imapCredentialSaved: !!b.imapSecret,
              smtpCredentialSaved: !!b.smtpSecret,
              sentCopy: b.sentCopy,
              permissions: b.permissions.map((p) => ({
                userId: p.userId,
                access: p.access,
                notify: p.notify,
                details: p.details,
              })),
            }
          : {}),
      })),
    };
  }
  async configure(actor: MailActor, id: string | undefined, input: any) {
    this.access.superadmin(actor);
    const existing = id ? await this.access.box(actor, id) : null;
    id ||= randomUUID();
    serverConfig(input);
    const address = addresses(input.address, false);
    if (address.length !== 1)
      throw new BadRequestException('MAILBOX_SINGLE_ADDRESS_REQUIRED');
    if (existing && existing.address !== address[0])
      throw new BadRequestException('MAILBOX_ADDRESS_IMMUTABLE_CREATE_NEW_BOX');
    if (input.username?.trim().toLowerCase() !== address[0])
      throw new BadRequestException('MAILBOX_USERNAME_MUST_MATCH_ADDRESS');
    const data: any = {
      name: header(input.name, 100),
      address: address[0],
      fromName: header(input.fromName, 100),
      provider: input.provider,
      imapHost: input.imapHost,
      imapPort: input.imapPort,
      smtpHost: input.smtpHost,
      smtpPort: input.smtpPort,
      username: address[0],
      active: !!input.active,
      notify: input.notify !== false,
      sentCopy: input.sentCopy === 'provider' ? 'provider' : 'append',
      status: 'PENDING_CONFIG',
      errorCode: null,
      nextSyncAt: new Date(),
      leaseToken: null,
      leaseUntil: existing?.leaseUntil ?? null,
    };
    for (const type of ['imap', 'smtp']) {
      if (input[type + 'Password']) {
        data[type + 'Secret'] = encrypt(
          input[type + 'Password'],
          `${id}:${type}`,
        );
        data[type + 'SecretRef'] = null;
      } else if (input[type + 'SecretRef']) {
        const ref = String(input[type + 'SecretRef']);
        if (
          !/^(?:SMTP_[A-Z0-9_]+_PASS|MAILBOX_[A-Z0-9_]+_(?:PASS|PASSWORD))$/.test(
            ref,
          )
        )
          throw new BadRequestException('CREDENTIAL_REFERENCE_NOT_ALLOWED');
        data[type + 'SecretRef'] = ref;
        data[type + 'Secret'] = null;
      }
    }
    if (!existing || (!existing.active && input.active))
      data.activatedAt = new Date();
    const permissions = input.permissions || [];
    if (permissions.length > 50)
      throw new BadRequestException('MAILBOX_TOO_MANY_PERMISSIONS');
    const adminIds = (
      await this.db.user.findMany({
        where: {
          id: { in: permissions.map((p) => p.userId) },
          role: 'ADMIN',
          accountState: 'ACTIVE',
        },
        select: { id: true },
      })
    ).map((u) => u.id);
    if (
      permissions.some(
        (p) =>
          !adminIds.includes(p.userId) || !['read', 'send'].includes(p.access),
      )
    )
      throw new BadRequestException('MAILBOX_PERMISSION_REQUIRES_ACTIVE_ADMIN');
    await this.db.$transaction(async (tx) => {
      if (existing) {
        const result = await tx.mailbox.updateMany({
          where: { id, revision: input.revision },
          data: { ...data, revision: { increment: 1 } },
        });
        if (!result.count)
          throw new ConflictException('MAILBOX_CONFIGURATION_CHANGED');
      } else await tx.mailbox.create({ data: { id, ...data } });
      await tx.mailboxPermission.deleteMany({ where: { mailboxId: id } });
      for (const p of permissions)
        await tx.mailboxPermission.create({
          data: {
            mailboxId: id!,
            userId: p.userId,
            access: p.access,
            notify: p.notify !== false,
            details: p.details === true,
          },
        });
    });
    await this.access.audit(actor, id, 'CONFIGURE', id);
    return this.overview(actor);
  }
  async diagnose(actor: MailActor, id: string) {
    this.access.superadmin(actor);
    const box = await this.access.box(actor, id);
    return this.leases.run(id, async () => {
      try {
        const result = await this.provider.diagnose(box);
        await this.access.audit(actor, id, 'CONNECTION_TEST', id);
        return result;
      } catch (e) {
        const code = safeError(e);
        await this.access.audit(actor, id, 'CONNECTION_TEST', id, code);
        return { imap: 'NOT_VERIFIED', smtp: 'NOT_VERIFIED', errorCode: code };
      }
    });
  }
  async refresh(actor: MailActor, id: string) {
    const box = await this.access.box(actor, id);
    if (!box.active) throw new BadRequestException('MAILBOX_INACTIVE');
    if (process.env.MAILBOX_WORKER_ENABLED !== 'true')
      throw new ServiceUnavailableException('MAILBOX_WORKER_DISABLED');
    await this.db.mailbox.update({
      where: { id },
      data: { nextSyncAt: new Date() },
    });
    return { queued: true };
  }
  async messages(actor: MailActor, query: any) {
    const ids = await this.access.allowedIds(actor);
    if (query.mailboxId && !ids.includes(query.mailboxId))
      await this.access.box(actor, query.mailboxId);
    const search = String(query.search || '').slice(0, 120),
      page = Math.max(1, Math.min(100000, Number(query.page) || 1));
    const where: any = {
      mailboxId: { in: query.mailboxId ? [query.mailboxId] : ids },
      alive: true,
      folder: { available: true },
      ...(query.folderId
        ? { folderId: query.folderId }
        : query.folderKind
          ? {
              folder: {
                available: true,
                OR: [
                  { specialUse: query.folderKind },
                  ...(query.folderKind === '\\Inbox'
                    ? [{ path: 'INBOX' }]
                    : []),
                ],
              },
            }
          : {}),
      ...(query.state === 'unread'
        ? { seen: false }
        : query.state === 'read'
          ? { seen: true }
          : {}),
      ...(search
        ? {
            OR: [
              { subject: { contains: search, mode: 'insensitive' } },
              { sender: { contains: search, mode: 'insensitive' } },
              { recipients: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    if (Object.prototype.hasOwnProperty.call(query, 'folderIds')) {
      if (typeof query.folderIds !== 'string' || query.folderIds.length > 15000)
        throw new BadRequestException('MAILBOX_INVALID_FOLDERS');
      const selected = [
        ...new Set<string>(
          (query.folderIds as string).split(',').filter(Boolean),
        ),
      ];
      if (selected.length > 200)
        throw new BadRequestException('MAILBOX_INVALID_FOLDERS');
      const allowed = await this.db.mailboxFolder.findMany({
        where: {
          id: { in: selected },
          mailboxId: where.mailboxId,
          available: true,
        },
        select: { id: true },
      });
      if (allowed.length !== selected.length)
        throw new BadRequestException('MAILBOX_INVALID_FOLDERS');
      where.folderId = { in: selected };
      where.folder = { available: true };
    }
    const [total, rows] = await this.db.$transaction([
      this.db.mailboxMessage.count({ where }),
      this.db.mailboxMessage.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * 25,
        take: 25,
      }),
    ]);
    const freshIds = await this.access.allowedIds(actor);
    if (ids.some((id) => !freshIds.includes(id)))
      throw new ConflictException('MAILBOX_ACCESS_CHANGED');
    return {
      messages: rows.map((m) => this.reader.view(m)),
      pagination: {
        page,
        pageSize: 25,
        total,
        pages: Math.max(1, Math.ceil(total / 25)),
      },
      scope:
        'Solo metadatos de mensajes sincronizados. Los cuerpos se descargan al abrir.',
    };
  }
  async drafts(actor: MailActor) {
    const ids = await this.access.allowedIds(actor, true);
    return this.db.mailboxDraft.findMany({
      where: { userId: actor.id, mailboxId: { in: ids } },
      select: {
        id: true,
        mailboxId: true,
        subject: true,
        status: true,
        revision: true,
        updatedAt: true,
        sends: {
          select: {
            id: true,
            status: true,
            errorCode: true,
            sentCopyStatus: true,
            accepted: true,
            rejected: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        campaigns: {
          select: {
            id: true,
            status: true,
            scheduledAt: true,
            startedAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
  }
  async createDraft(actor: MailActor, input: any) {
    const box = await this.access.box(actor, input.mailboxId, true);
    let data: any = {
      mailboxId: box.id,
      userId: actor.id,
      mode: input.messageId
        ? 'individual'
        : input.mode === 'circles'
          ? 'circles'
          : 'individual',
    };
    if (input.messageId) {
      const source = await this.access.message(actor, input.messageId);
      if (source.mailboxId !== box.id)
        throw new BadRequestException('MAILBOX_REPLY_MUST_USE_ORIGINAL_BOX');
      const loaded = await this.reader.body(actor, source.id);
      const mode = input.mode;
      const recipients = replyRecipients(
        source.envelope,
        box.address,
        mode === 'replyAll',
      );
      data = {
        ...data,
        ...(mode === 'forward' ? { to: '', cc: '' } : recipients),
        subject: header(
          (mode === 'forward' ? 'Fwd: ' : 'Re: ') + source.subject,
        ),
        text: `\n\n---------- Mensaje original ----------\n${source.sender}\n${source.subject}\n${loaded.body.text || ''}`.slice(
          0,
          1000000,
        ),
        ...(mode === 'forward'
          ? {}
          : {
              inReplyTo:
                source.messageId &&
                /^<[^<>\r\n]{1,200}>$/.test(source.messageId)
                  ? source.messageId
                  : null,
              references: [
                ...loaded.body.references,
                ...(source.messageId ? [source.messageId] : []),
              ]
                .filter((r) => /^<[^<>\r\n]{1,200}>$/.test(r))
                .slice(-50),
            }),
      };
    }
    const draft = await this.db.mailboxDraft.create({ data });
    if (input.messageId && input.mode === 'forward') {
      const source = await this.access.message(actor, input.messageId);
      for (const f of source.files) {
        const file = await this.reader.file(actor, f.id);
        const copy = await this.files.write(file.stream, maxAttachmentBytes());
        await this.db.mailboxFile.create({
          data: {
            ...copy,
            mailboxId: box.id,
            draftId: draft.id,
            name: f.name,
            mimeType: f.mimeType,
          },
        });
      }
    }
    return this.draftView(await this.access.draft(actor, draft.id));
  }
  draftView(d: any) {
    return {
      id: d.id,
      mailboxId: d.mailboxId,
      to: d.to,
      cc: d.cc,
      bcc: d.bcc,
      subject: d.subject,
      text: d.text,
      html: d.html,
      mode: d.mode,
      circles: d.circles,
      templateId: d.templateId,
      campaigns: (d.campaigns || []).map((c) => ({
        id: c.id,
        status: c.status,
        scheduledAt: c.scheduledAt,
        startedAt: c.startedAt,
      })),
      revision: d.revision,
      status: d.status,
      files: d.files.map((f) => ({ id: f.id, name: f.name, size: f.size })),
      sends: d.sends.map((s) => ({
        id: s.id,
        status: s.status,
        errorCode: s.errorCode,
        sentCopyStatus: s.sentCopyStatus,
        accepted: s.accepted,
        rejected: s.rejected,
      })),
    };
  }
  async saveDraft(actor: MailActor, id: string, input: any) {
    const draft = await this.access.draft(actor, id);
    const mailboxId = input.mailboxId || draft.mailboxId;
    if (mailboxId !== draft.mailboxId) {
      await this.access.box(actor, mailboxId, true);
      if (draft.mode !== 'circles' || draft.files.length)
        throw new BadRequestException(
          'MAILBOX_SENDER_CHANGE_REQUIRES_EMPTY_ATTACHMENTS',
        );
    }
    if (draft.mode === 'circles' && (input.to || input.cc || input.bcc))
      throw new BadRequestException('MAILBOX_CIRCLES_BCC_ONLY');
    if (input.templateId) {
      const list = await this.campaigns?.templateList(actor, mailboxId);
      if (!list?.some((t) => t.id === input.templateId))
        throw new BadRequestException('MAILBOX_TEMPLATE_NOT_AVAILABLE');
    }
    for (const key of ['to', 'cc', 'bcc']) header(input[key], 15000);
    header(input.subject);
    if (typeof input.text !== 'string' || input.text.length > 1000000)
      throw new BadRequestException('MAILBOX_BODY_TOO_LARGE');
    const result = await this.db.mailboxDraft.updateMany({
      where: {
        id,
        userId: actor.id,
        status: 'DRAFT',
        revision: input.revision,
      },
      data: {
        mailboxId,
        templateId: input.templateId || null,
        circles: draft.mode === 'circles' ? circles(input.circles || []) : [],
        html: input.html ? effectiveMailHtml(input.html, true) : '',
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        subject: input.subject,
        text: input.text,
        revision: { increment: 1 },
      },
    });
    if (!result.count)
      throw new ConflictException('MAILBOX_DRAFT_CHANGED_OR_QUEUED');
    return this.draftView(await this.access.draft(actor, id));
  }
  async upload(
    actor: MailActor,
    id: string,
    source: Readable,
    name: string,
    mimeType: string,
  ) {
    const draft = await this.access.draft(actor, id);
    if (draft.status !== 'DRAFT')
      throw new ConflictException('MAILBOX_DRAFT_QUEUED');
    if (
      draft.files.length >= 10 ||
      draft.files.reduce((a, f) => a + f.size, 0) >= maxMessageBytes()
    )
      throw new BadRequestException('MAILBOX_ATTACHMENTS_LIMIT');
    const file = await this.files.write(source, maxAttachmentBytes());
    try {
      return await this.db.$transaction(async (tx) => {
        const locked = await tx.mailboxDraft.updateMany({
          where: { id, status: 'DRAFT', revision: draft.revision },
          data: { revision: { increment: 1 } },
        });
        if (!locked.count) throw new ConflictException('MAILBOX_DRAFT_CHANGED');
        return tx.mailboxFile.create({
          data: {
            ...file,
            mailboxId: draft.mailboxId,
            draftId: id,
            name,
            mimeType,
          },
        });
      });
    } catch (e) {
      await this.files.remove(file.key);
      throw e;
    }
  }
  async removeFile(actor: MailActor, id: string) {
    const file = await this.db.mailboxFile.findUniqueOrThrow({ where: { id } });
    if (!file.draftId)
      throw new BadRequestException('MAILBOX_NOT_A_DRAFT_FILE');
    const draft = await this.access.draft(actor, file.draftId);
    await this.db.$transaction(async (tx) => {
      const r = await tx.mailboxDraft.updateMany({
        where: { id: draft.id, status: 'DRAFT', revision: draft.revision },
        data: { revision: { increment: 1 } },
      });
      if (!r.count) throw new ConflictException('MAILBOX_DRAFT_CHANGED');
      await tx.mailboxFile.delete({ where: { id } });
    });
    if (file.key) await this.files.remove(file.key);
    return { ok: true };
  }
  async enqueue(actor: MailActor, id: string, input: any, session: any) {
    if (
      process.env.MAILBOX_SEND_ENABLED !== 'true' ||
      process.env.MAILBOX_WORKER_ENABLED !== 'true'
    )
      throw new ServiceUnavailableException('MAILBOX_SENDING_DISABLED');
    const draft = await this.access.draft(actor, id);
    if (draft.mode === 'circles')
      throw new BadRequestException('MAILBOX_USE_CAMPAIGN_CONFIRMATION');
    if (!draft.mailbox.active)
      throw new BadRequestException('MAILBOX_INACTIVE');
    const prior = await this.db.mailboxSend.findUnique({
      where: { requestKey: input.requestKey },
    });
    if (prior) {
      if (prior.draftId !== id || prior.userId !== actor.id)
        throw new ConflictException('MAILBOX_IDEMPOTENCY_KEY_USED');
      return this.draftView(await this.access.draft(actor, id));
    }
    const to = addresses(draft.to, false),
      cc = addresses(draft.cc),
      bcc = addresses(draft.bcc);
    if (new Set([...to, ...cc, ...bcc]).size > maxRecipients())
      throw new BadRequestException('MAILBOX_RECIPIENT_LIMIT');
    header(draft.subject);
    assertResolved(draft.subject, draft.text, draft.html);
    header(draft.mailbox.fromName);
    if (draft.files.reduce((a, f) => a + f.size, 0) > maxMessageBytes())
      throw new BadRequestException('MAILBOX_ATTACHMENTS_LIMIT');
    credential(
      draft.mailbox.smtpSecretRef,
      draft.mailbox.smtpSecret,
      `${draft.mailboxId}:smtp`,
    );
    this.files.root();
    keyring();
    await this.db.$transaction(async (tx) => {
      const locked = await tx.mailboxDraft.updateMany({
        where: { id, status: 'DRAFT', revision: input.revision },
        data: { status: 'QUEUED' },
      });
      if (!locked.count)
        throw new ConflictException('MAILBOX_DRAFT_CHANGED_OR_QUEUED');
      if (
        (await tx.mailboxSend.count({
          where: {
            userId: actor.id,
            createdAt: { gt: new Date(Date.now() - 3600000) },
          },
        })) >= 20
      )
        throw new BadRequestException('MAILBOX_SEND_HOURLY_LIMIT');
      await tx.mailboxSend.create({
        data: {
          draftId: id,
          draftRevision: draft.revision,
          userId: actor.id,
          sessionId: session.sid,
          sessionVersion: session.sv,
          requestKey: input.requestKey,
          messageId: `<${randomUUID()}@${draft.mailbox.address.split('@')[1]}>`,
        },
      });
    });
    await this.access.audit(actor, draft.mailboxId, 'QUEUE_SEND', id);
    return this.draftView(await this.access.draft(actor, id));
  }
  async clone(actor: MailActor, id: string, acknowledge: boolean) {
    const source = await this.access.draft(actor, id);
    if(source.mode==='circles') throw new BadRequestException('MAILBOX_CAMPAIGN_CLONE_NOT_SUPPORTED');
    if (
      source.sends.some(
        (s) => s.status === 'PROCESSING' || s.status === 'PENDING',
      )
    )
      throw new ConflictException('MAILBOX_SEND_STILL_RUNNING');
    if (
      source.sends.some((s) =>
        ['UNKNOWN', 'SMTP_ACCEPTED'].includes(s.status),
      ) &&
      !acknowledge
    )
      throw new BadRequestException(
        'MAILBOX_POSSIBLE_DUPLICATE_REQUIRES_ACKNOWLEDGEMENT',
      );
    const draft = await this.db.mailboxDraft.create({
      data: {
        mailboxId: source.mailboxId,
        userId: actor.id,
        to: source.to,
        cc: source.cc,
        bcc: source.bcc,
        subject: source.subject,
        text: source.text,
        html: source.html,
        mode: source.mode,
        circles: source.circles,
        templateId: source.templateId,
        inReplyTo: source.inReplyTo,
        references: source.references,
      },
    });
    for (const f of source.files) {
      if (!f.key) continue;
      const copy = await this.files.write(
        await this.files.read(f.key),
        maxAttachmentBytes(),
      );
      await this.db.mailboxFile.create({
        data: {
          ...copy,
          mailboxId: source.mailboxId,
          draftId: draft.id,
          name: f.name,
          mimeType: f.mimeType,
        },
      });
    }
    return this.draftView(await this.access.draft(actor, draft.id));
  }
}
