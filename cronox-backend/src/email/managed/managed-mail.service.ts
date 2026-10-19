import { mailCircleNumber, resolveMailCircle } from './mail-circle-folders';
import { CANONICAL_MAIL_CIRCLES, draftScope, draftContentMatches } from './mail-draft-scope';
import { requireWelcomeCode } from './welcome-code';
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
import Handlebars from 'handlebars';
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
import { mailPreviewData, welcomeDocument, WELCOME_SUBJECT } from './welcome-design';
import {
  adaptFirstPartyDocument,
  structuredDocumentForPurpose,
  passwordSetupDesign,
} from './mail-template-documents';
import {
  FolderDeleteDto,
  MailActionDto,
  MailListDto,
  MailMultiSaveDto,
  MailSaveDto,
  MailPreviewDto,
  SignatureDto,
} from './mail.dto';

type Tx = Prisma.TransactionClient;
// Internal operator capability, deliberately absent from the HTTP test DTO.
// It permits an explicitly authorized sample email without weakening real
// welcome eligibility or enabling local background delivery.
export type ControlledWelcomeDraftTest = { requestKey: string; revision: number; subjectId?: string };
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
      label: {
        INFO: 'Información y novedades',
        ORDERS: 'Pedidos',
        NOREPLY: 'No-reply',
        SUPPORT: 'Soporte',
      }[key],
      localOnly: process.env.CRONOX_LOCAL_DEV === 'true',
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
      include: { _count: { select: { folders: true, templates: { where: { archivedAt: null } } } } },
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
        for (let circle = 1; circle <= 5; circle++) await resolveMailCircle(tx, key, circle, true);
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
          const folder = await resolveMailCircle(tx, key, circle, true);
          for (const { purpose: p, document } of sources) {
            const legacy = p.key.startsWith('PASSWORD_SETUP_') ? await tx.managedEmailTemplate.findUnique({ where: { importKey: `${key}:${circle}:INITIAL_PASSWORD_SETUP` } }) : null;
            const compatibleDocument = legacy ? json(passwordSetupDesign(legacy.document, p.key)) : document;
            const rendered = renderMail(compatibleDocument, p.subject, '', p.key);
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
                document: compatibleDocument,
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
      include: { _count: { select: { templates: { where: { archivedAt: null } } } } },
    });
  }
  /** Explicit operator import only. Never called by initialization or delivery.
   * A distinct identity preserves the existing welcome, including publications.
   * Subsequent imports preserve every field, even if edited or archived. */
  async importApprovedWelcomeDraft() {
    const key = EmailSenderKey.NOREPLY;
    const importKey = 'NOREPLY:1:NEWSLETTER_WELCOME:approved-20261019';
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-import:${importKey}`}))`;
      const existing = await tx.managedEmailTemplate.findUnique({ where: { importKey } });
      if (existing) return { created: false, template: existing };
      const folder = await resolveMailCircle(tx, key, 1);
      const name = 'Bienvenida · Diseño aprobado';
      // Do not create an indistinguishable second card over an earlier manual
      // import. An operator must reconcile that identity without overwriting it.
      if (await tx.managedEmailTemplate.findFirst({ where: { senderKey: key, folderId: folder.id, name } }))
        throw new ConflictException('Ya existe un diseño aprobado en este círculo; se conserva sin cambios.');
      const document = json(welcomeDocument());
      const rendered = renderMail(document, WELCOME_SUBJECT, '', 'NEWSLETTER_WELCOME');
      const template = await tx.managedEmailTemplate.create({ data: {
        importKey, senderKey: key, folderId: folder.id, name,
        purpose: 'NEWSLETTER_WELCOME', subject: WELCOME_SUBJECT,
        visualClassification: 'UNIQUE', signatureMode: 'none', document,
        html: rendered.html, text: rendered.text,
      } });
      await this.audit(tx, undefined, 'EMAIL_APPROVED_WELCOME_DRAFT_IMPORT', template.id);
      return { created: true, template };
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
    const normalizedName = name.normalize('NFD').replace(/\p{M}/gu, '').trim();
    if (!mailCircleNumber(name) && /^(?:circulo|\d+$|VI$|VII$|VIII$|IX$|X$)/i.test(normalizedName))
      throw new BadRequestException('Plantillas Mail utiliza únicamente los cinco círculos canónicos, del 1 al 5.');
    return this.db.$transaction(async (tx) => {
      const current = id ? await this.folder(tx, key, id) : null;
      const requestedCircle = mailCircleNumber(name);
      if (current && mailCircleNumber(current.name) && requestedCircle !== mailCircleNumber(current.name)) throw new BadRequestException('Las cinco carpetas canónicas de círculos conservan su identidad y nombre.');
      if (requestedCircle) {
        const canonical = await resolveMailCircle(tx, key, requestedCircle);
        if (id && canonical.id !== id) throw new BadRequestException('Utiliza la carpeta canónica existente; no se puede renombrar otra carpeta como círculo.');
        return canonical;
      }
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
      const targetFolder = await this.folder(tx, key, id);
      if (mailCircleNumber(targetFolder.name)) throw new BadRequestException('Las carpetas canónicas de círculos no se pueden eliminar.');
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
        if (dto.mode === 'archive') {
          await tx.$queryRaw`SELECT id FROM "ManagedEmailTemplate" WHERE "folderId"=${id} AND "senderKey"=${key} ORDER BY id FOR UPDATE`;
          const templates = await tx.managedEmailTemplate.findMany({ where: { folderId: id, senderKey: key, archivedAt: null }, select: { id: true } });
          for (const template of templates) {
            const dependencies = await this.deletion(key, template.id, tx);
            if (!dependencies.canDelete) throw new ConflictException(dependencies.blockers.join(' '));
            await this.audit(tx, actorId, 'EMAIL_ARCHIVE', template.id);
          }
        }
        await tx.managedEmailTemplate.updateMany({
          where: { folderId: id, senderKey: key },
          data: {
            folderId: dto.destinationId,
            ...(dto.mode === 'archive' ? { archivedAt: new Date() } : {}),
            revision: { increment: 1 },
            updatedBy: actorId,
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
      AND: [{ OR: [{ purpose: null }, { purpose: { in: MAIL_PURPOSES.filter(p => p.senderKey === key).map(p => p.key) } }] }],
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
          visualClassification: true,
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
  async campaignFamilies(key: string) {
    if (key !== 'INFO')
      throw new BadRequestException(
        'Las familias de campaña pertenecen a Información.',
      );
    const families = await this.db.campaignTemplateFamily.findMany({
      where: { id: { notIn: ['campaign:INFO:LAUNCH', 'campaign:INFO:RESTOCK', 'campaign:INFO:GENERIC'] } },
      include: {
        versions: {
          select: {
            id: true,
            name: true,
            campaignCircle: true,
            subject: true,
            revision: true,
            archivedAt: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    const available = await this.db.managedEmailTemplate.findMany({
      where: {
        senderKey: 'INFO',
        archivedAt: null,
        familyId: null,
        purpose: null,
      },
      select: { id: true, name: true, purpose: true, revision: true },
      orderBy: { name: 'asc' },
    });
    return { families, available };
  }
  async saveCampaignFamily(
    key: string,
    dto: { name: string; eventKind: string; revision?: number },
    id?: string,
  ) {
    if (key !== 'INFO' || !dto.name.trim())
      throw new BadRequestException('Familia de campaña no válida.');
    if (!id)
      return this.db.campaignTemplateFamily.create({
        data: { name: dto.name.trim(), eventKind: dto.eventKind },
      });
    if (!Number.isInteger(dto.revision)) failConflict();
    const changed = await this.db.campaignTemplateFamily.updateMany({
      where: { id, revision: dto.revision, eventKind: dto.eventKind },
      data: { name: dto.name.trim(), revision: { increment: 1 } },
    });
    if (!changed.count) failConflict();
    return this.db.campaignTemplateFamily.findUniqueOrThrow({ where: { id } });
  }
  async linkCampaignVersion(
    key: string,
    id: string,
    circle: number,
    dto: { templateId: string; revision: number },
  ) {
    if (key !== 'INFO' || !Number.isInteger(circle) || circle < 1 || circle > 5)
      throw new BadRequestException('Identidad de círculo no válida.');
    return this.db.$transaction(async (tx) => {
      const family = await tx.campaignTemplateFamily.findUniqueOrThrow({
        where: { id },
      });
      const t = await this.template(key, dto.templateId, tx);
      const purpose =
        family.eventKind === 'GENERAL' ? 'GENERIC' : family.eventKind;
      if (
        t.archivedAt ||
        (t.purpose && t.purpose !== purpose) ||
        t.familyId ||
        t.revision !== dto.revision
      )
        throw new BadRequestException(
          'Selecciona una plantilla disponible del mismo evento, sin otra identidad de campaña.',
        );
      if (
        await tx.managedEmailTemplate.findFirst({
          where: { familyId: id, campaignCircle: circle },
        })
      )
        throw new ConflictException(
          'El círculo ya tiene una versión. Edita su contenido sin sustituir su identidad.',
        );
      const linked = await tx.managedEmailTemplate.updateMany({
        where: { id: t.id, revision: dto.revision, familyId: null, archivedAt: null },
        data: {
          familyId: id,
          campaignCircle: circle,
          revision: { increment: 1 },
        },
      });
      if (!linked.count) failConflict();
      await tx.campaignTemplateFamily.update({
        where: { id },
        data: { revision: { increment: 1 } },
      });
      return this.template(key, t.id, tx);
    });
  }
  async template(key: string, id: string, tx: Tx = this.db) {
    const result = await tx.managedEmailTemplate.findFirst({
      where: { id, senderKey: key },
    });
    if (!result || (result.purpose && !MAIL_PURPOSES.some(p => p.key === result.purpose && p.senderKey === key)))
      throw new NotFoundException('Plantilla no encontrada en esta cuenta.');
    return {
      ...result,
      document: adaptFirstPartyDocument(result.purpose, result.document),
    };
  }
  async draftTargets(key: EmailSenderKey, id: string, tx: Tx = this.db) {
    const source = await this.template(key, id, tx);
    if (source.archivedAt)
      throw new ConflictException('La plantilla está eliminada. Restaura el borrador antes de utilizarlo.');
    const scope = draftScope(source);
    const matches = await tx.managedEmailTemplate.findMany({
      where: {
        senderKey: key, purpose: source.purpose, archivedAt: null,
        OR: [{ id: source.id }, { AND: [scope.where, {
          folderId: { not: source.folderId },
          folder: { name: { in: CANONICAL_MAIL_CIRCLES } },
        }] }],
      },
      select: {
        id: true, name: true, folderId: true, revision: true, visualClassification: true,
        folder: { select: { name: true, position: true } },
      },
      orderBy: [{ folder: { position: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
    });
    return {
      purpose: source.purpose, relation: scope.kind,
      requiresExplicitSelection: scope.kind === 'explicit' && matches.length > 1,
      targets: matches.map(target => ({
        id: target.id, name: target.name, folderId: target.folderId,
        folderName: target.folder.name, revision: target.revision,
        visualClassification: target.visualClassification, current: target.id === id,
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
  async render(
    key: string,
    t: Pick<
      ManagedEmailTemplate,
      'subject' | 'preheader' | 'purpose' | 'signatureMode' | 'signatureId'
    > & { document: unknown; textOverride?: string | null },
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
    const result = renderMail(
      t.document,
      t.subject,
      t.preheader,
      t.purpose,
      data,
      signature,
      publishing,
    );
    if (t.textOverride != null) {
      // Validate the same variable vocabulary and syntax as the HTML editor.
      renderMail(
        { blocks: [{ type: 'text', text: t.textOverride }] },
        t.subject,
        '',
        t.purpose,
      );
      result.text = data
        ? Handlebars.compile(t.textOverride, { noEscape: true })(data)
        : t.textOverride;
    }
    return result;
  }
  private validateClassification(value: unknown) {
    if (value !== undefined && !['FOR_ALL', 'UNIQUE', 'DIFFERENT'].includes(value as string))
      throw new BadRequestException('Selecciona una de las tres clasificaciones visuales.');
  }
  async deletion(key: EmailSenderKey, id: string, tx: Tx = this.db) {
    const template = await this.template(key, id, tx);
    const [folder, publications, pendingCampaigns, versionCount, family] = await Promise.all([
      tx.emailTemplateFolder.findFirstOrThrow({ where: { id: template.folderId, senderKey: key }, select: { name: true } }),
      tx.emailPublication.findMany({ where: { senderKey: key, version: { templateId: id } }, select: { purpose: true } }),
      tx.mailboxCampaign.count({ where: {
        status: { in: ['SCHEDULED', 'PROCESSING'] }, cancelledAt: null,
        OR: [
          { snapshot: { path: ['versions'], array_contains: [{ templateId: id }] } },
          { snapshot: { path: ['templateId'], equals: id } },
          { versions: { some: { content: { path: ['templateId'], equals: id } } } },
          { deliveries: { some: { content: { path: ['templateId'], equals: id } } } },
        ],
      } }),
      tx.emailTemplateVersion.count({ where: { templateId: id } }),
      template.familyId ? tx.campaignTemplateFamily.findUnique({ where: { id: template.familyId }, select: { name: true } }) : null,
    ]);
    const blockers: string[] = [];
    if (template.archivedAt) blockers.push('Esta plantilla ya está eliminada. Actualiza el listado.');
    if (publications.length) blockers.push('La plantilla está publicada. Abre el editor y utiliza «Despublicar plantilla» en Opciones avanzadas; después vuelve a eliminarla. La despublicación retira este diseño de los próximos correos automáticos, que usarán el diseño de respaldo configurado.');
    if (pendingCampaigns) blockers.push(`Hay ${pendingCampaigns} campaña(s) programada(s) o en curso que utilizan esta plantilla. Revisa Correo → Campañas y espera a que finalicen o resuélvelas explícitamente antes de eliminarla. No se cancelará ninguna campaña desde aquí.`);
    return {
      id, revision: template.revision, name: template.name, senderKey: key,
      folderName: folder.name, published: publications.length > 0,
      publications: publications.map(p => p.purpose), pendingCampaigns,
      versionCount, familyName: family?.name || null, campaignCircle: template.campaignCircle,
      canDelete: blockers.length === 0, blockers,
    };
  }
  async save(
    key: EmailSenderKey,
    dto: MailSaveDto,
    actorId?: number,
    id?: string,
  ) {
    this.validateClassification(dto.visualClassification);
    if (!dto.name.trim() || !dto.subject.trim())
      throw new BadRequestException('Nombre y asunto son obligatorios.');
    if (
      dto.purpose &&
      !MAIL_PURPOSES.some((p) => p.key === dto.purpose && p.senderKey === key)
    )
      throw new BadRequestException('Propósito incompatible con el remitente.');
    return this.db.$transaction(async (tx) => {
      await this.folder(tx, key, dto.folderId);
      const existing = id ? await this.template(key, id, tx) : null;
      if (existing) {
        if (existing.revision !== dto.revision) failConflict();
        if (existing.familyId && existing.purpose !== (dto.purpose || null))
          throw new BadRequestException(
            'La versión de campaña conserva su uso; no puede convertirse en transaccional.',
          );
      }
      const input = {
        ...(dto.visualClassification !== undefined ? { visualClassification: dto.visualClassification } : {}),
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
        ...(dto.textOverride !== undefined
          ? { textOverride: dto.textOverride }
          : existing?.textOverride != null
            ? { textOverride: existing.textOverride }
            : {}),
      };
      // Visual/name/folder edits must preserve the stored draft byte for byte,
      // including imported HTML and signatures that have changed since saving.
      const contentChanged = !existing ||
        input.subject !== existing.subject ||
        input.preheader !== existing.preheader ||
        input.purpose !== existing.purpose ||
        input.signatureMode !== existing.signatureMode ||
        input.signatureId !== existing.signatureId ||
        (input.textOverride ?? null) !== (existing.textOverride ?? null) ||
        JSON.stringify(input.document) !== JSON.stringify(existing.document);
      const rendered = contentChanged
        ? await this.render(key, input, undefined, false, tx)
        : { html: existing.html, text: existing.text };
      if (id) {
        const result = await tx.managedEmailTemplate.updateMany({
          where: { id, senderKey: key, revision: dto.revision },
          data: dto.visualClassification !== undefined && existing && draftContentMatches(existing, dto) ? {
            visualClassification: dto.visualClassification,
            updatedBy: actorId,
            revision: { increment: 1 },
          } : {
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
      if (dto.visualClassification !== undefined && dto.visualClassification !== existing?.visualClassification)
        await this.audit(tx, actorId, 'EMAIL_CLASSIFICATION_CHANGE', id);
      return this.template(key, id, tx);
    });
  }
  async saveDrafts(
    key: EmailSenderKey, id: string, dto: MailMultiSaveDto, actorId?: number,
  ) {
    this.validateClassification(dto.visualClassification);
    if (!dto.name.trim() || !dto.subject.trim())
      throw new BadRequestException('Nombre y asunto son obligatorios.');
    const targetIds = dto.targets.map(target => target.id);
    if (!targetIds.length || targetIds.length > 5 || new Set(targetIds).size !== targetIds.length || !targetIds.includes(id))
      throw new BadRequestException('Selección de círculos no válida.');
    return this.db.$transaction(async tx => {
      // Same row locks as archival/publication, in a deterministic order. All
      // validation and writes share this transaction; any failed CAS rolls back.
      await tx.$queryRaw`SELECT id FROM "ManagedEmailTemplate" WHERE id IN (${Prisma.join([...targetIds].sort())}) ORDER BY id FOR UPDATE`;
      const source = await this.template(key, id, tx);
      if (source.revision !== dto.revision) failConflict();
      if (source.archivedAt) throw new ConflictException('La plantilla está eliminada.');
      const classificationOnly = dto.visualClassification !== undefined && draftContentMatches(source, dto);
      // A later content save must not repaint siblings with the source's
      // unchanged color merely because an older client includes that field.
      const applyClassification = dto.visualClassification !== undefined &&
        (classificationOnly || dto.visualClassification !== source.visualClassification);
      if (dto.saveMode === 'classification' && !classificationOnly)
        throw new BadRequestException('El borrador también contiene cambios de contenido. Revisa el modo de guardado.');
      if (!classificationOnly && source.familyId)
        throw new BadRequestException('Edita el contenido de cada versión de campaña por separado.');
      if (source.folderId !== dto.folderId)
        throw new BadRequestException('Guarda primero el cambio de círculo antes de guardar en varios.');
      if ((dto.purpose || null) !== source.purpose)
        throw new BadRequestException('El propósito del borrador no coincide con la plantilla origen.');
      const available = await this.draftTargets(key, id, tx);
      if (targetIds.length > 1 && available.requiresExplicitSelection && dto.explicitSelection !== true)
        throw new BadRequestException('Selecciona explícitamente las copias: no hay una relación guardada entre estos diseños.');
      const allowed = new Set(available.targets.map(target => target.id));
      if (targetIds.some(target => !allowed.has(target)))
        throw new BadRequestException('Alguna plantilla no pertenece a las copias seleccionables de este diseño y buz?n.');
      const targets = await tx.managedEmailTemplate.findMany({ where: { id: { in: targetIds } }, include: { folder: true } });
      if (targets.length !== targetIds.length) throw new BadRequestException('Alguna plantilla seleccionada no existe.');
      const revisions = new Map(dto.targets.map(target => [target.id, target.revision]));
      for (const target of targets) {
        if (target.senderKey !== String(key) || target.purpose !== source.purpose || target.archivedAt)
          throw new BadRequestException('Plantilla incompatible o eliminada en la selección.');
        if (!CANONICAL_MAIL_CIRCLES.includes(target.folder.name))
          throw new BadRequestException('Selecciona únicamente los cinco círculos canónicos.');
        if (revisions.get(target.id) !== target.revision) failConflict();
      }
      if (new Set(targets.map(target => target.folderId)).size !== targets.length)
        throw new BadRequestException('Selecciona una sola copia por círculo.');
      const draft = {
        subject: dto.subject, preheader: dto.preheader, document: json(dto.document),
        signatureMode: dto.signatureMode,
        signatureId: dto.signatureMode === 'selected' ? dto.signatureId || null : null,
      };
      // No rendering, normalization or copy of another circle's content for a
      // classification-only operation (including legacy/imported documents).
      const rendered = classificationOnly ? null : await this.render(key, { ...draft, purpose: source.purpose }, undefined, false, tx);
      for (const target of targets) {
        const changed = await tx.managedEmailTemplate.updateMany({
          where: { id: target.id, senderKey: key, revision: target.revision, archivedAt: null },
          data: {
            ...(classificationOnly ? {} : { ...draft, html: rendered!.html, text: rendered!.text,
              ...(target.id === id ? { name: dto.name.trim() } : {}) }),
            ...(applyClassification ? { visualClassification: dto.visualClassification } : {}),
            updatedBy: actorId, revision: { increment: 1 },
          },
        });
        if (changed.count !== 1) failConflict();
        await this.audit(tx, actorId, classificationOnly ? 'EMAIL_CLASSIFICATION_SAVE' : target.id === id ? 'EMAIL_DRAFT_SAVE' : 'EMAIL_DRAFT_SYNC', target.id);
        if (applyClassification && dto.visualClassification !== target.visualClassification)
          await this.audit(tx, actorId, 'EMAIL_CLASSIFICATION_CHANGE', target.id);
      }
      return {
        template: await this.template(key, id, tx), mode: classificationOnly ? 'classification' : 'content',
        updated: targets.map(target => ({ id: target.id, folderId: target.folderId,
          folderName: target.folder.name, revision: target.revision + 1,
          visualClassification: applyClassification ? dto.visualClassification : target.visualClassification })),
      };
    }, { timeout: 20000 });
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
              visualClassification: t.visualClassification,
              subject: t.subject,
              preheader: t.preheader,
              purpose: t.purpose,
              signatureMode: t.signatureMode,
              signatureId: t.signatureId,
              html: t.html,
              text: t.text,
              textOverride: t.textOverride,
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
        case 'archive': {
          if (!dto.confirmed)
            throw new BadRequestException('Confirma la eliminación de esta plantilla.');
          const dependencies = await this.deletion(key, id, tx);
          if (!dependencies.canDelete)
            throw new ConflictException(dependencies.blockers.join(' '));
          await tx.managedEmailTemplate.update({
            where: { id },
            data: { archivedAt: new Date() },
          });
          break;
        }
        case 'unpublish':
          if (!dto.confirmed)
            throw new BadRequestException('Confirma la despublicación antes de continuar.');
          await tx.emailPublication.deleteMany({ where: { senderKey: key, version: { templateId: id } } });
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
          await this.render(key, t, mailPreviewData(t.purpose), true, tx);
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
              textOverride: snapshot.textOverride || null,
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
  async preview(key: EmailSenderKey, dto: MailPreviewDto) {
    await this.folder(this.db, key, dto.folderId);
    return this.render(
      key,
      {
        ...dto,
        document: json(dto.document),
        purpose: dto.purpose || null,
        signatureId: dto.signatureId || null,
      },
      mailPreviewData(dto.purpose),
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
    if (!publication && purpose.startsWith('PASSWORD_SETUP_')) {
      const legacy = await this.db.emailPublication.findUnique({ where: { senderKey_purpose: { senderKey: key, purpose: 'INITIAL_PASSWORD_SETUP' } }, include: { version: true } });
      if (!legacy) return null;
      const original = legacy.version.snapshot as unknown as ManagedEmailTemplate;
      if (original.senderKey !== String(key) || original.purpose !== 'INITIAL_PASSWORD_SETUP') throw Error('Publicación incompatible');
      return this.render(key, { ...original, purpose, subject: String(data.subject || ''),
        textOverride: null,
        document: json(passwordSetupDesign(original.document, purpose)) }, data, true);
    }
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
    controlled?: ControlledWelcomeDraftTest,
  ) {
    if (controlled) {
      const localUrl = new URL(process.env.DATABASE_URL || 'invalid:');
      if (process.env.CRONOX_LOCAL_DEV !== 'true' || !['127.0.0.1', 'localhost', '[::1]'].includes(localUrl.hostname) ||
          process.env.BACKGROUND_JOBS_ENABLED !== 'false' || process.env.MAILBOX_WORKER_ENABLED !== 'false' ||
          process.env.NEWSLETTER_EMAIL_WORKER_ENABLED !== 'false' || process.env.WAITLIST_EMAIL_WORKER_ENABLED !== 'false' ||
          key !== EmailSenderKey.NOREPLY || !confirmed || !actorId ||
          !Number.isSafeInteger(controlled.revision) || controlled.revision < 1 ||
          !/^welcome-draft-test:[a-zA-Z0-9-]{8,70}$/.test(controlled.requestKey) ||
          (controlled.subjectId !== undefined && !/^[a-zA-Z0-9-]{6,50}$/.test(controlled.subjectId)) ||
          !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) {
        throw new BadRequestException('CONTROLLED_WELCOME_TEST_REQUIRES_ISOLATED_LOCAL_PROCESS');
      }
      const actor = await this.db.user.findUnique({ where: { id: actorId }, select: { role: true } });
      if (actor?.role !== 'SUPERADMIN') throw new BadRequestException('CONTROLLED_WELCOME_TEST_REQUIRES_SUPERADMIN');
    }
    if (process.env.CRONOX_LOCAL_DEV === 'true' && !controlled) {
      const template = await this.template(key, id);
      const rendered = await this.render(key, template, mailPreviewData(template.purpose));
      return {
        localOnly: true,
        html: rendered.html,
        text: rendered.text,
        subject: rendered.subject,
        message:
          'Prueba local con variables de ejemplo. No se ha enviado ningún correo.',
      };
    }
    if (
      !confirmed ||
      !this.metadata().find((a) => a.key === String(key))?.configured
    )
      throw new BadRequestException(
        'Confirma el destinatario y configura el envío de esta cuenta.',
      );
    const t = await this.template(key, id);
    let data = mailPreviewData(t.purpose);
    if (controlled) {
      const folder = await this.folder(this.db, key, t.folderId);
      if (t.purpose !== 'NEWSLETTER_WELCOME' || t.importKey !== 'NOREPLY:1:NEWSLETTER_WELCOME' ||
          t.archivedAt || t.revision !== controlled.revision || folder.name !== 'Círculo 1' ||
          (t.document as { format?: string }).format !== 'html-email') {
        throw new BadRequestException('CONTROLLED_WELCOME_DRAFT_CHANGED');
      }
    } else if (t.purpose === 'NEWSLETTER_WELCOME') {
      const user = await this.db.user.findFirst({ where: { email: { equals: to.trim(), mode: 'insensitive' } } });
      const promo = user?.firstOrderDiscountCode ? await this.db.promoCode.findUnique({ where: { code: user.firstOrderDiscountCode } }) : null;
      if (!user || !promo || user.firstOrderDiscountUsed || !promo.isActive || promo.usageCount || !promo.firstOrderOnly || promo.type !== 'PERCENT' || promo.value !== 10 || promo.ownerEmail?.toLowerCase() !== user.email.toLowerCase() || (promo.ownerUserId != null && promo.ownerUserId !== user.id)) throw new BadRequestException('WELCOME_PERSONAL_CODE_UNAVAILABLE: el destinatario no tiene un código personal de bienvenida disponible.');
      data = { ...data, discountCode: requireWelcomeCode(promo.code, true) };
    }
    const rendered = await this.render(key, t, data, Boolean(controlled));
    // Atomic per-admin limit also covers requests from different IPs.
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mail-test:${actorId}`}))`;
      if (controlled) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${controlled.requestKey}))`;
        if (await tx.auditLog.findUnique({ where: { requestKey: controlled.requestKey } }))
          throw new ConflictException('CONTROLLED_WELCOME_TEST_ALREADY_ATTEMPTED: revisa el resultado; no se repite el envío.');
        const current = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "ManagedEmailTemplate" WHERE id=${id} AND revision=${controlled.revision} AND "archivedAt" IS NULL FOR SHARE`;
        if (current.length !== 1) throw new ConflictException('CONTROLLED_WELCOME_DRAFT_CHANGED');
      }
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
      if (controlled) await tx.auditLog.create({ data: {
        requestKey: controlled.requestKey, actorId, action: 'EMAIL_TEST_ATTEMPT', actionType: 'EMAIL_TEST_ATTEMPT',
        targetType: 'EMAIL_TEMPLATE', targetId: id,
        metadata: { sampleData: true, revision: controlled.revision, recipient: to },
      } });
      else await this.audit(tx, actorId, 'EMAIL_TEST_ATTEMPT', id);
    });
    try {
      const info = (await this.transport.sendMail(
        key,
        {
          to,
          subject: `[PRUEBA${controlled?.subjectId ? ' ' + controlled.subjectId : ''}] ${rendered.subject}`,
          html: rendered.html,
          text: rendered.text,
        },
        'ADMIN_TEST',
        ...(controlled ? [Date.now() + 60000] : []),
      )) as { messageId: string; accepted?: unknown[]; queued?: boolean };
      if (controlled && (!info.messageId || info.queued || info.accepted?.length !== 1 || String(info.accepted[0]).toLowerCase() !== to.toLowerCase()))
        throw new Error('CONTROLLED_WELCOME_SMTP_ACCEPTANCE_UNVERIFIED');
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
