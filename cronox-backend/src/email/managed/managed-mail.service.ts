import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, ManagedEmailTemplate } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { MailTransportFactory } from '../mail-transport.factory';
import { loadEmailConfig } from '../email.config';
import { EMAIL_TEMPLATE_FILE, EmailSenderKey } from '../email.types';
import {
  MAIL_PURPOSES,
  SAMPLE_DATA,
  VARIABLE_DESCRIPTIONS,
  variablesFor,
} from './mail-catalog';
import { renderMail } from './mail-renderer';
import {
  adaptFirstPartyDocument,
  structuredDocumentForPurpose,
} from './mail-template-documents';
import {
  FolderDeleteDto,
  MailActionDto,
  MailListDto,
  MailMultiSaveDto,
  MailSaveDto,
  SignatureDto,
} from './mail.dto';

type Tx = Prisma.TransactionClient;
const json = (data: unknown) =>
  JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
const failConflict = () => {
  throw new ConflictException(
    'El contenido cambió en otra sesión. Recarga antes de guardar.',
  );
};

@Injectable()
export class ManagedMailService {
  private readonly logger = new Logger(ManagedMailService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly transport: MailTransportFactory,
  ) {}

  private audit(
    tx: Tx,
    actorId: number | undefined,
    action: string,
    targetId: string,
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        action,
        actionType: action,
        targetType: 'EMAIL_TEMPLATE',
        targetId,
      },
    });
  }
  metadata() {
    const config = loadEmailConfig();
    return Object.values(EmailSenderKey).map((key) => ({
      key: String(key),
      email: config.accounts[key].user,
      name: config.accounts[key].fromName,
      configured: Boolean(
        config.enabled &&
          config.smtpHost &&
          config.accounts[key].user &&
          config.accounts[key].pass,
      ),
    }));
  }
  async accounts() {
    const profiles = await this.db.emailSenderProfile.findMany({
      include: { _count: { select: { folders: true, templates: true } } },
    });
    return this.metadata().map((a) => ({
      ...a,
      defaultSignatureId:
        profiles.find((p) => p.key === a.key)?.defaultSignatureId || null,
      counts: profiles.find((p) => p.key === a.key)?._count || {
        folders: 0,
        templates: 0,
      },
    }));
  }
  async initialize(key: EmailSenderKey, actorId?: number) {
    // One transaction and an account-scoped lock: imports never overwrite edits.
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-init:${key}`}))`;
        const profile = await tx.emailSenderProfile.upsert({
          where: { key },
          update: {},
          create: { key },
        });
        // Reconcile newly introduced first-party purposes without overwriting
        // any existing imported template or administrator edit.
        const purposes = MAIL_PURPOSES.filter((p) => p.senderKey === key);
        if (profile.initializedAt) {
          const expectedKeys = purposes.flatMap((purpose) =>
            Array.from(
              { length: 5 },
              (_, index) => `${key}:${index + 1}:${purpose.key}`,
            ),
          );
          const existingCount = await tx.managedEmailTemplate.count({
            where: { importKey: { in: expectedKeys } },
          });
          if (existingCount === expectedKeys.length) return profile;
        }
        const sources = await Promise.all(
          purposes.map(async (p) => {
            const name = EMAIL_TEMPLATE_FILE[p.template];
            let source: string;
            try {
              source = await readFile(
                join(__dirname, '..', 'templates', name),
                'utf8',
              );
            } catch {
              source = await readFile(
                join(process.cwd(), 'src/email/templates', name),
                'utf8',
              );
            }
            const legacySource = {
              blocks: [{ type: 'html', html: source, padding: 0 }],
            };
            return {
              purpose: p,
              document: json(
                structuredDocumentForPurpose(p.key, legacySource) ||
                  legacySource,
              ),
            };
          }),
        );
        for (let circle = 1; circle <= 5; circle++) {
          const folder = await tx.emailTemplateFolder.upsert({
            where: {
              senderKey_name: { senderKey: key, name: `Círculo ${circle}` },
            },
            update: {},
            create: {
              senderKey: key,
              name: `Círculo ${circle}`,
              position: circle - 1,
            },
          });
          for (const { purpose: p, document } of sources) {
            const rendered = renderMail(document, p.subject, '', p.key);
            await tx.managedEmailTemplate.upsert({
              where: { importKey: `${key}:${circle}:${p.key}` },
              update: {},
              create: {
                importKey: `${key}:${circle}:${p.key}`,
                senderKey: key,
                folderId: folder.id,
                name: p.name,
                purpose: p.key,
                subject: p.subject,
                document,
                html: rendered.html,
                text: rendered.text,
                createdBy: actorId,
                updatedBy: actorId,
              },
            });
          }
        }
        await this.audit(tx, actorId, 'EMAIL_INITIALIZE', key);
        return tx.emailSenderProfile.update({
          where: { key },
          data: { initializedAt: new Date() },
        });
      },
      { timeout: 20000 },
    );
  }
  async folders(key: EmailSenderKey) {
    return this.db.emailTemplateFolder.findMany({
      where: { senderKey: key },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { templates: true } } },
    });
  }
  private async folder(tx: Tx, key: string, id: string) {
    const folder = await tx.emailTemplateFolder.findFirst({
      where: { id, senderKey: key },
    });
    if (!folder)
      throw new NotFoundException('Carpeta no encontrada en esta cuenta.');
    return folder;
  }
  async saveFolder(
    key: EmailSenderKey,
    name: string,
    id?: string,
    actorId?: number,
  ) {
    if (!name.trim())
      throw new BadRequestException('Escribe un nombre de carpeta.');
    return this.db.$transaction(async (tx) => {
      if (id) await this.folder(tx, key, id);
      const result = id
        ? await tx.emailTemplateFolder.update({
            where: { id },
            data: { name: name.trim() },
          })
        : await tx.emailTemplateFolder.create({
            data: {
              senderKey: key,
              name: name.trim(),
              position: await tx.emailTemplateFolder.count({
                where: { senderKey: key },
              }),
            },
          });
      await this.audit(tx, actorId, 'EMAIL_FOLDER_SAVE', result.id);
      return result;
    });
  }
  async reorder(key: EmailSenderKey, ids: string[], actorId?: number) {
    return this.db.$transaction(async (tx) => {
      const rows = await tx.emailTemplateFolder.findMany({
        where: { senderKey: key },
      });
      if (
        rows.length !== ids.length ||
        new Set(ids).size !== ids.length ||
        rows.some((r) => !ids.includes(r.id))
      )
        throw new BadRequestException('Orden de carpetas no válido.');
      for (const [position, id] of ids.entries())
        await tx.emailTemplateFolder.update({
          where: { id },
          data: { position },
        });
      await this.audit(tx, actorId, 'EMAIL_FOLDER_REORDER', key);
      return { ok: true };
    });
  }
  async deleteFolder(
    key: EmailSenderKey,
    id: string,
    dto: FolderDeleteDto,
    actorId?: number,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.folder(tx, key, id);
      const count = await tx.managedEmailTemplate.count({
        where: { folderId: id },
      });
      if (count && dto.mode === 'empty')
        throw new ConflictException(
          'La carpeta contiene plantillas. Muévelas, archívalas o cancela.',
        );
      if (count) {
        if (!dto.destinationId || dto.destinationId === id)
          throw new BadRequestException(
            'Selecciona otra carpeta de destino para conservar las plantillas.',
          );
        await this.folder(tx, key, dto.destinationId);
        await tx.managedEmailTemplate.updateMany({
          where: { folderId: id, senderKey: key },
          data: {
            folderId: dto.destinationId,
            ...(dto.mode === 'archive' ? { archivedAt: new Date() } : {}),
            revision: { increment: 1 },
            updatedBy: actorId,
          },
        });
        if (dto.mode === 'archive')
          await tx.emailPublication.deleteMany({
            where: {
              senderKey: key,
              version: {
                template: {
                  folderId: dto.destinationId,
                  archivedAt: { not: null },
                },
              },
            },
          });
      }
      await tx.emailTemplateFolder.delete({ where: { id } });
      await this.audit(tx, actorId, 'EMAIL_FOLDER_DELETE', id);
      return { ok: true };
    });
  }
  async list(key: EmailSenderKey, query: MailListDto) {
    const where: Prisma.ManagedEmailTemplateWhereInput = {
      senderKey: key,
      ...(query.folderId ? { folderId: query.folderId } : {}),
      archivedAt: query.archived === 'true' ? { not: null } : null,
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { subject: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.managedEmailTemplate.findMany({
        where,
        select: {
          versions: {
            where: { publications: { some: { senderKey: key } } },
            select: { id: true },
            take: 1,
          },
          id: true,
          name: true,
          subject: true,
          folderId: true,
          purpose: true,
          revision: true,
          archivedAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { [query.sort]: query.sort === 'name' ? 'asc' : 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.managedEmailTemplate.count({ where }),
    ]);
    return {
      items: items.map(({ versions, ...t }) => ({
        ...t,
        published: versions.length > 0,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }
  async template(key: string, id: string, tx: Tx = this.db) {
    const result = await tx.managedEmailTemplate.findFirst({
      where: { id, senderKey: key },
    });
    if (!result)
      throw new NotFoundException('Plantilla no encontrada en esta cuenta.');
    return {
      ...result,
      document: adaptFirstPartyDocument(result.purpose, result.document),
    };
  }
  async draftTargets(key: EmailSenderKey, id: string) {
    const source = await this.db.managedEmailTemplate.findFirst({
      where: { id, senderKey: key },
      select: {
        id: true,
        purpose: true,
        folderId: true,
        revision: true,
        archivedAt: true,
        folder: { select: { name: true, position: true } },
      },
    });
    if (!source)
      throw new NotFoundException('Plantilla no encontrada en esta cuenta.');
    const supported = MAIL_PURPOSES.some(
      (purpose) => purpose.key === source.purpose && purpose.senderKey === key,
    );
    if (!supported)
      return {
        purpose: source.purpose,
        targets: [
          {
            id: source.id,
            folderId: source.folderId,
            folderName: source.folder.name,
            revision: source.revision,
            current: true,
          },
        ],
      };
    const matches = await this.db.managedEmailTemplate.findMany({
      where: {
        senderKey: key,
        purpose: source.purpose,
        archivedAt: null,
        OR: [{ id: source.id }, { folderId: { not: source.folderId } }],
      },
      select: {
        id: true,
        folderId: true,
        revision: true,
        folder: { select: { name: true, position: true } },
      },
      orderBy: [
        { folder: { position: 'asc' } },
        { folder: { name: 'asc' } },
        { createdAt: 'asc' },
      ],
    });
    if (!matches.some((match) => match.id === source.id))
      matches.unshift(source);
    return {
      purpose: source.purpose,
      targets: matches.map((target) => ({
        id: target.id,
        folderId: target.folderId,
        folderName: target.folder.name,
        revision: target.revision,
        current: target.id === source.id,
      })),
    };
  }
  private async signature(
    key: string,
    mode: string,
    id: string | null | undefined,
    tx: Tx = this.db,
  ) {
    if (mode === 'none') return undefined;
    if (mode === 'default')
      id = (await tx.emailSenderProfile.findUnique({ where: { key } }))
        ?.defaultSignatureId;
    if (!id && mode === 'default') return undefined;
    const signature = id
      ? await tx.emailSignature.findFirst({
          where: { id, senderKey: key, archivedAt: null },
        })
      : null;
    if (!signature)
      throw new BadRequestException('Firma no disponible en esta cuenta.');
    return signature.document;
  }
  private async render(
    key: string,
    t: Pick<
      ManagedEmailTemplate,
      'subject' | 'preheader' | 'purpose' | 'signatureMode' | 'signatureId'
    > & { document: unknown },
    data?: Record<string, unknown>,
    publishing = false,
    tx: Tx = this.db,
  ) {
    const signature = await this.signature(
      key,
      t.signatureMode,
      t.signatureId,
      tx,
    );
    return renderMail(
      t.document,
      t.subject,
      t.preheader,
      t.purpose,
      data,
      signature,
      publishing,
    );
  }
  async save(
    key: EmailSenderKey,
    dto: MailSaveDto,
    actorId?: number,
    id?: string,
  ) {
    if (!dto.name.trim() || !dto.subject.trim())
      throw new BadRequestException('Nombre y asunto son obligatorios.');
    if (
      dto.purpose &&
      !MAIL_PURPOSES.some((p) => p.key === dto.purpose && p.senderKey === key)
    )
      throw new BadRequestException('Propósito incompatible con el remitente.');
    return this.db.$transaction(async (tx) => {
      await this.folder(tx, key, dto.folderId);
      if (id) {
        const existing = await this.template(key, id, tx);
        if (existing.revision !== dto.revision) failConflict();
      }
      const input = {
        name: dto.name.trim(),
        folderId: dto.folderId,
        subject: dto.subject,
        preheader: dto.preheader,
        purpose: dto.purpose || null,
        document: json(dto.document),
        signatureMode: dto.signatureMode,
        signatureId:
          dto.signatureMode === 'selected' ? dto.signatureId || null : null,
        updatedBy: actorId,
      };
      const rendered = await this.render(key, input, undefined, false, tx);
      if (id) {
        const result = await tx.managedEmailTemplate.updateMany({
          where: { id, senderKey: key, revision: dto.revision },
          data: {
            ...input,
            html: rendered.html,
            text: rendered.text,
            revision: { increment: 1 },
          },
        });
        if (result.count !== 1) failConflict();
      } else {
        const created = await tx.managedEmailTemplate.create({
          data: {
            ...input,
            senderKey: key,
            createdBy: actorId,
            html: rendered.html,
            text: rendered.text,
          },
        });
        id = created.id;
      }
      await this.audit(tx, actorId, 'EMAIL_DRAFT_SAVE', id);
      return this.template(key, id, tx);
    });
  }
  async saveDrafts(
    key: EmailSenderKey,
    id: string,
    dto: MailMultiSaveDto,
    actorId?: number,
  ) {
    if (!dto.name.trim() || !dto.subject.trim())
      throw new BadRequestException('Nombre y asunto son obligatorios.');
    const targetIds = dto.targets.map((target) => target.id);
    if (new Set(targetIds).size !== targetIds.length || !targetIds.includes(id))
      throw new BadRequestException('Selección de círculos no válida.');
    return this.db.$transaction(async (tx) => {
      const source = await this.template(key, id, tx);
      if (
        !source.purpose ||
        !MAIL_PURPOSES.some(
          (purpose) =>
            purpose.key === source.purpose && purpose.senderKey === key,
        ) ||
        dto.purpose !== source.purpose
      )
        throw new BadRequestException(
          'El propósito del borrador no coincide con la plantilla origen.',
        );
      if (source.revision !== dto.revision) failConflict();
      if (source.folderId !== dto.folderId)
        throw new BadRequestException(
          'Guarda primero el cambio de círculo antes de sincronizar.',
        );
      const sourceFolder = await this.folder(tx, key, dto.folderId);
      const targets = await tx.managedEmailTemplate.findMany({
        where: { id: { in: targetIds } },
        select: {
          id: true,
          senderKey: true,
          purpose: true,
          folderId: true,
          revision: true,
          archivedAt: true,
          folder: { select: { name: true } },
        },
      });
      if (targets.length !== targetIds.length)
        throw new BadRequestException(
          'Alguna plantilla seleccionada no existe.',
        );
      const requested = new Map(
        dto.targets.map((target) => [target.id, target.revision]),
      );
      for (const target of targets) {
        if (target.senderKey !== String(key))
          throw new BadRequestException(
            'No se pueden guardar borradores en otra cuenta remitente.',
          );
        if (target.purpose !== source.purpose)
          throw new BadRequestException(
            'Todas las plantillas deben tener exactamente el mismo propósito.',
          );
        if (target.archivedAt)
          throw new BadRequestException(
            'No se puede actualizar una plantilla archivada.',
          );
        if (requested.get(target.id) !== target.revision) failConflict();
      }
      const selectedFolders = targets.map((target) =>
        target.id === id ? dto.folderId : target.folderId,
      );
      if (new Set(selectedFolders).size !== selectedFolders.length)
        throw new BadRequestException(
          'Sólo se puede seleccionar una plantilla por círculo.',
        );
      const draft = {
        subject: dto.subject,
        preheader: dto.preheader,
        document: json(dto.document),
        signatureMode: dto.signatureMode,
        signatureId:
          dto.signatureMode === 'selected' ? dto.signatureId || null : null,
        updatedBy: actorId,
      };
      const rendered = await this.render(
        key,
        {
          ...draft,
          purpose: source.purpose,
        },
        undefined,
        false,
        tx,
      );
      for (const target of targets) {
        const result = await tx.managedEmailTemplate.updateMany({
          where: {
            id: target.id,
            senderKey: key,
            purpose: source.purpose,
            revision: target.revision,
          },
          data: {
            ...draft,
            ...(target.id === id
              ? { name: dto.name.trim(), folderId: dto.folderId }
              : {}),
            html: rendered.html,
            text: rendered.text,
            revision: { increment: 1 },
          },
        });
        if (result.count !== 1) failConflict();
        await this.audit(
          tx,
          actorId,
          target.id === id ? 'EMAIL_DRAFT_SAVE' : 'EMAIL_DRAFT_SYNC',
          target.id,
        );
      }
      return {
        template: await this.template(key, id, tx),
        updated: targets.map((target) => ({
          id: target.id,
          folderId: target.id === id ? dto.folderId : target.folderId,
          folderName: target.id === id ? sourceFolder.name : target.folder.name,
          revision: target.revision + 1,
        })),
      };
    });
  }
  async action(
    key: EmailSenderKey,
    id: string,
    dto: MailActionDto,
    actorId?: number,
  ) {
    return this.db.$transaction(async (tx) => {
      const t = await this.template(key, id, tx);
      if (t.revision !== dto.revision) failConflict();
      // Claim the revision before snapshotting, moving, or changing publication.
      const claimed = await tx.managedEmailTemplate.updateMany({
        where: { id, revision: dto.revision },
        data: { revision: { increment: 1 }, updatedBy: actorId },
      });
      if (!claimed.count) failConflict();
      switch (dto.action) {
        case 'duplicate': {
          await this.folder(tx, key, dto.folderId || t.folderId);
          const created = await tx.managedEmailTemplate.create({
            data: {
              senderKey: key,
              subject: t.subject,
              preheader: t.preheader,
              purpose: t.purpose,
              signatureMode: t.signatureMode,
              signatureId: t.signatureId,
              html: t.html,
              text: t.text,
              document: json(t.document),
              folderId: dto.folderId || t.folderId,
              name: dto.name?.trim() || `${t.name} (copia)`,
              archivedAt: null,
              createdBy: actorId,
              updatedBy: actorId,
            },
          });
          await this.audit(tx, actorId, 'EMAIL_DUPLICATE', created.id);
          return created;
        }
        case 'move':
          await this.folder(tx, key, dto.folderId || '');
          await tx.managedEmailTemplate.update({
            where: { id },
            data: { folderId: dto.folderId },
          });
          break;
        case 'rename':
          if (!dto.name?.trim())
            throw new BadRequestException('Escribe un nombre.');
          await tx.managedEmailTemplate.update({
            where: { id },
            data: { name: dto.name.trim() },
          });
          break;
        case 'archive':
          await tx.managedEmailTemplate.update({
            where: { id },
            data: { archivedAt: new Date() },
          });
          await tx.emailPublication.deleteMany({
            where: { senderKey: key, version: { templateId: id } },
          });
          break;
        case 'restore':
          await tx.managedEmailTemplate.update({
            where: { id },
            data: { archivedAt: null },
          });
          break;
        case 'publish': {
          if (
            !dto.confirmed ||
            !t.purpose ||
            t.archivedAt ||
            !MAIL_PURPOSES.some(
              (p) => p.key === t.purpose && p.senderKey === key,
            )
          )
            throw new BadRequestException(
              'Confirma la activación de una plantilla válida de esta cuenta.',
            );
          await this.render(key, t, SAMPLE_DATA, true, tx);
          const v = await tx.emailTemplateVersion.create({
            data: { templateId: id, snapshot: json(t), createdBy: actorId },
          });
          await tx.emailPublication.upsert({
            where: {
              senderKey_purpose: { senderKey: key, purpose: t.purpose },
            },
            update: { versionId: v.id },
            create: { senderKey: key, purpose: t.purpose, versionId: v.id },
          });
          break;
        }
        case 'restoreVersion': {
          const version = await tx.emailTemplateVersion.findFirst({
            where: { id: dto.versionId || '', templateId: id },
          });
          if (!version) throw new NotFoundException('Versión no encontrada.');
          const snapshot = version.snapshot as unknown as ManagedEmailTemplate;
          const rendered = await this.render(
            key,
            snapshot,
            undefined,
            false,
            tx,
          );
          await tx.managedEmailTemplate.update({
            where: { id },
            data: {
              name: snapshot.name,
              document: json(snapshot.document),
              subject: snapshot.subject,
              preheader: snapshot.preheader,
              purpose: snapshot.purpose,
              signatureMode: snapshot.signatureMode,
              signatureId: snapshot.signatureId,
              html: rendered.html,
              text: rendered.text,
            },
          });
          break;
        }
      }
      await this.audit(tx, actorId, `EMAIL_${dto.action.toUpperCase()}`, id);
      return this.template(key, id, tx);
    });
  }
  async versions(key: EmailSenderKey, id: string) {
    await this.template(key, id);
    return this.db.emailTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        createdAt: true,
        createdBy: true,
        publications: { select: { purpose: true } },
      },
    });
  }
  async preview(key: EmailSenderKey, dto: MailSaveDto) {
    await this.folder(this.db, key, dto.folderId);
    return this.render(
      key,
      {
        ...dto,
        document: json(dto.document),
        purpose: dto.purpose || null,
        signatureId: dto.signatureId || null,
      },
      SAMPLE_DATA,
    );
  }
  async published(
    key: EmailSenderKey,
    purpose: string,
    data: Record<string, unknown>,
  ) {
    if (!MAIL_PURPOSES.some((p) => p.key === purpose && p.senderKey === key))
      return null;
    const publication = await this.db.emailPublication.findUnique({
      where: { senderKey_purpose: { senderKey: key, purpose } },
      include: { version: true },
    });
    if (!publication) return null;
    const snapshot = publication.version
      .snapshot as unknown as ManagedEmailTemplate;
    if (snapshot.senderKey !== String(key) || snapshot.purpose !== purpose)
      throw new Error('Publicación incompatible');
    return this.render(key, snapshot, data, true);
  }
  async signatures(key: EmailSenderKey) {
    return this.db.emailSignature.findMany({
      where: { senderKey: key },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }
  async saveSignature(
    key: EmailSenderKey,
    dto: SignatureDto,
    actorId?: number,
    id?: string,
  ) {
    renderMail(dto.document, 'Firma');
    if (JSON.stringify(dto.document).includes('"type":"signature"'))
      throw new BadRequestException('Una firma no puede incluir otra firma.');
    return this.db.$transaction(async (tx) => {
      const data = {
        name: dto.name.trim(),
        document: json(dto.document),
        archivedAt: dto.archived ? new Date() : null,
        updatedBy: actorId,
      };
      if (!data.name) throw new BadRequestException('Escribe un nombre.');
      if (id) {
        const result = await tx.emailSignature.updateMany({
          where: { id, senderKey: key, revision: dto.revision ?? -1 },
          data: { ...data, revision: { increment: 1 } },
        });
        if (!result.count) failConflict();
      } else {
        id = (
          await tx.emailSignature.create({
            data: { ...data, senderKey: key, createdBy: actorId },
          })
        ).id;
      }
      if (dto.archived)
        await tx.emailSenderProfile.updateMany({
          where: { key, defaultSignatureId: id },
          data: { defaultSignatureId: null },
        });
      else if (dto.isDefault)
        await tx.emailSenderProfile.update({
          where: { key },
          data: { defaultSignatureId: id },
        });
      await this.audit(tx, actorId, 'EMAIL_SIGNATURE_SAVE', id);
      return tx.emailSignature.findUniqueOrThrow({ where: { id } });
    });
  }
  async test(
    key: EmailSenderKey,
    id: string,
    to: string,
    confirmed: boolean,
    actorId?: number,
  ) {
    if (
      !confirmed ||
      !this.metadata().find((a) => a.key === String(key))?.configured
    )
      throw new BadRequestException(
        'Confirma el destinatario y configura el envío de esta cuenta.',
      );
    const t = await this.template(key, id);
    const rendered = await this.render(key, t, SAMPLE_DATA);
    // Atomic per-admin limit also covers requests from different IPs.
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-test:${actorId}`}))`;
      const recent = await tx.auditLog.count({
        where: {
          actorId,
          action: 'EMAIL_TEST_ATTEMPT',
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      });
      if (recent >= 3)
        throw new BadRequestException(
          'Espera un minuto antes de enviar más pruebas.',
        );
      await this.audit(tx, actorId, 'EMAIL_TEST_ATTEMPT', id);
    });
    try {
      const info = (await this.transport.sendMail(key, {
        to,
        subject: `[PRUEBA] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      }, 'ADMIN_TEST')) as { messageId: string; accepted?: unknown[] };
      if (info.accepted && !info.accepted.length)
        throw new Error('No aceptado');
      // The attempt is already durable. An audit failure after SMTP acceptance
      // must not suggest the administrator should send the same message again.
      try {
        await this.audit(this.db, actorId, 'EMAIL_TEST_ACCEPTED', id);
      } catch {
        this.logger.warn(
          'SMTP aceptó la prueba, pero no se pudo completar su auditoría.',
        );
      }
      return {
        messageId: info.messageId,
        message:
          'Prueba aceptada por el servidor SMTP; no confirma la entrega al buzón.',
      };
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo confirmar el envío de prueba. Comprueba SMTP antes de reintentar.',
      );
    }
  }
  catalog() {
    return MAIL_PURPOSES.map((p) => ({
      ...p,
      variables: variablesFor(p.key).map((key) => ({
        key,
        description: VARIABLE_DESCRIPTIONS[key] || key,
      })),
    }));
  }
}
