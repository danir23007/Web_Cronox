import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserAccountState } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../prisma/prisma.service';
import { CircleService } from '../../membership/circle.service';
import {
  assertUsableAccreditation,
  parseAccreditationPayload,
} from '../../membership/accreditation-identity';
import { CreateQrEventDto, QrEventQueryDto } from './qr-events.dto';

const memberSelect = {
  id: true,
  identityUid: true,
  firstName: true,
  publicMemberToken: true,
} as const;
const participantInclude = {
  user: { select: memberSelect },
  registeredBy: { select: { id: true, identityUid: true, firstName: true } },
} as const;
type Participant = Prisma.QrEventParticipantGetPayload<{
  include: typeof participantInclude;
}>;
type Group = Prisma.QrEventGroupGetPayload<{
  include: { _count: { select: { participants: true } } };
}>;
const unavailable = () =>
  new NotFoundException({
    code: 'GROUP_UNAVAILABLE',
    message: 'Grupo no disponible',
  });
const invalidQr = () =>
  new BadRequestException({
    code: 'INVALID_QR',
    message: 'QR no válido o desconocido',
  });
const describeGroup = (group: Group) => ({
  id: group.id,
  name: group.name,
  description: group.description,
  archived: group.archived,
  total: group._count.participants,
  createdAt: group.createdAt,
});
const describeParticipant = (row: Participant) => ({
  id: row.id,
  // Resolve the current authentic administrative number through the immutable
  // identity relation, including historical participations. UUIDs remain technical.
  userId: row.user?.id ?? null,
  publicUserId: row.user?.identityUid ?? null,
  qrIdentifier: row.user?.publicMemberToken ?? null,
  name: row.user?.firstName ?? '',
  deleted: !row.user,
  circleAtRegistration: row.circleAtRegistration,
  registeredAt: row.registeredAt,
  registeredBy: row.registeredBy
    ? {
        id: row.registeredBy.id,
        publicUserId: row.registeredBy.identityUid,
        name: row.registeredBy.firstName ?? '',
      }
    : null,
});

@Injectable()
export class QrEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly circles: CircleService,
  ) {}

  async list(query: QrEventQueryDto) {
    const { page = 1, limit = 50 } = query;
    const where: Prisma.QrEventGroupWhereInput = {
      archived: false,
      ...(query.q?.trim()
        ? { name: { contains: query.q.trim(), mode: 'insensitive' } }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const total = await tx.qrEventGroup.count({ where });
        const items = await tx.qrEventGroup.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
          include: { _count: { select: { participants: true } } },
        });
        return {
          items: items.map(describeGroup),
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async create(body: CreateQrEventDto, actorId: number) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { identityUid: true },
    });
    if (!actor) throw new ForbiddenException('Permiso insuficiente');
    return describeGroup(
      await this.prisma.qrEventGroup.create({
        data: {
          name: body.name,
          description: body.description ?? '',
          createdByIdentityUid: actor.identityUid,
        },
        include: { _count: { select: { participants: true } } },
      }),
    );
  }

  async get(id: string) {
    const group = await this.prisma.qrEventGroup.findUnique({
      where: { id },
      include: { _count: { select: { participants: true } } },
    });
    if (!group || group.archived) throw unavailable();
    return describeGroup(group);
  }

  async delete(id: string, confirmed: boolean, actorId: number) {
    if (confirmed !== true) throw new BadRequestException('Confirma expresamente la eliminación del evento.');
    return this.prisma.$transaction(async tx => {
      // Same row as scan's FOR SHARE. Wait for earlier registrations and fence
      // new scans before deleting any participant. Missing UUIDs are idempotent.
      const groups = await tx.$queryRaw<Array<{ name: string }>>`
        SELECT name FROM "QrEventGroup" WHERE id=${id}::uuid FOR UPDATE`;
      const actors = await tx.$queryRaw<Array<{ role: Role; accountState: UserAccountState }>>`
        SELECT role,"accountState" FROM "User" WHERE id=${actorId} FOR SHARE`;
      if (actors[0]?.role !== Role.SUPERADMIN || actors[0]?.accountState !== UserAccountState.ACTIVE) {
        throw new ForbiddenException('Solo un SUPERADMIN activo puede eliminar eventos QR.');
      }
      if (!groups[0]) return { id, deleted: true, alreadyDeleted: true, participantsDeleted: 0 };
      const removed = await tx.qrEventParticipant.deleteMany({ where: { groupId: id } });
      await tx.qrEventGroup.delete({ where: { id } });
      await tx.auditLog.create({ data: {
        actorId, action: 'qr_event.delete', actionType: 'qr_event.delete',
        targetType: 'qr_event_group', targetId: id, requestKey: `qr-event-delete:${id}`,
        metadata: { name: groups[0].name, participantsDeleted: removed.count },
      } });
      return { id, deleted: true, alreadyDeleted: false, participantsDeleted: removed.count };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15000 });
  }

  async participants(groupId: string, query: QrEventQueryDto) {
    const { page = 1, limit = 50 } = query;
    const q = query.q?.trim();
    const where: Prisma.QrEventParticipantWhereInput = {
      groupId,
      ...(q
        ? {
            user: {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { publicMemberToken: { contains: q } },
                ...(/^\d+$/.test(q) && Number(q) <= 2147483647
                  ? [{ id: Number(q) }]
                  : []),
                ...(/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
                  q,
                )
                  ? [{ identityUid: q }]
                  : []),
              ],
            },
          }
        : {}),
    };
    return this.prisma.$transaction(
      async (tx) => {
        const group = await tx.qrEventGroup.findUnique({
          where: { id: groupId },
          include: { _count: { select: { participants: true } } },
        });
        if (!group || group.archived) throw unavailable();
        const total = await tx.qrEventParticipant.count({ where });
        const items = await tx.qrEventParticipant.findMany({
          where,
          include: participantInclude,
          orderBy: [{ registeredAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        });
        return {
          group: describeGroup(group),
          items: items.map(describeParticipant),
          total,
          page,
          limit,
          pages: Math.max(1, Math.ceil(total / limit)),
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
  }

  async exportIds(groupId: string) {
    // One snapshot for the full group, independent of the visible table's search
    // and pagination. Never infer numbers from UUIDs or participation positions.
    const { groupName, ids } = await this.prisma.$transaction(
      async (tx) => {
        const group = await tx.qrEventGroup.findUnique({
          where: { id: groupId },
          include: { _count: { select: { participants: true } } },
        });
        if (!group || group.archived) throw unavailable();
        if (!group._count.participants) {
          throw new BadRequestException({
            code: 'EMPTY_GROUP',
            message: 'No hay participantes en este grupo.',
          });
        }
        if (group._count.participants > 1048575) {
          throw new BadRequestException({
            code: 'EXCEL_ROW_LIMIT',
            message: 'El grupo supera el límite de filas de una hoja de Excel.',
          });
        }
        const participants = await tx.qrEventParticipant.findMany({
          where: { groupId },
          select: { user: { select: { id: true } } },
        });
        if (participants.some((row) => !row.user)) {
          // Deleted accounts deliberately leave anonymous event history. Do not
          // invent an ID or silently produce an incomplete export for that group.
          throw new ConflictException({
            code: 'UNRESOLVED_PARTICIPANT_ID',
            message:
              'Hay participantes sin una cuenta vinculada (por ejemplo, cuentas eliminadas). No se puede generar un Excel completo de IDs reales.',
          });
        }
        const ids = [...new Set(participants.map((row) => row.user!.id))].sort(
          (a, b) => a - b,
        );
        return { groupName: group.name, ids };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    // Reuse the installed ExcelJS dependency. The general export builder adds
    // title/date/filter rows, which are intentionally absent from this workbook.
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('IDs');
    sheet.getColumn(1).width = 18;
    sheet.getColumn(1).numFmt = '0';
    sheet.addRow(['ID de usuario']);
    sheet.getRow(1).font = { bold: true };
    for (const id of ids) sheet.addRow([id]);
    const slug = groupName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
      .replace(/-+$/g, '');
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      filename: `eventos-qr-${slug || 'grupo'}-ids.xlsx`,
    };
  }

  async scan(groupId: string, qrContent: string, actorId: number) {
    const token = parseAccreditationPayload(qrContent);
    return this.prisma.$transaction(
      async (tx) => {
        const groups = await tx.$queryRaw<
          Array<{ archived: boolean }>
        >`SELECT "archived" FROM "QrEventGroup" WHERE "id"=${groupId}::uuid FOR SHARE`;
        if (!groups[0] || groups[0].archived) throw unavailable();
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { identityUid: true, role: true, accountState: true },
        });
        if (!actor || actor.accountState !== UserAccountState.ACTIVE ||
            (actor.role !== Role.ADMIN && actor.role !== Role.SUPERADMIN)) {
          throw new ForbiddenException('Permiso insuficiente');
        }
        const initial = await tx.user.findUnique({ where: { publicMemberToken: token }, select: { id: true } });
        if (!initial) throw invalidQr();
        // Reuse this transaction/connection, including the existing promotion
        // rules. A deleted event never reaches a circle/user mutation, and
        // concurrent scanners cannot exhaust the pool with nested transactions.
        await this.circles.maybePromoteRequestedCircle(initial.id, tx);
        const users = await tx.$queryRaw<
          Array<{
            identityUid: string;
            accountState: UserAccountState;
            circleLevel: number;
          }>
        >`
        SELECT "identityUid", "accountState", "circleLevel" FROM "User" WHERE "publicMemberToken"=${token} FOR SHARE`;
        if (!users[0]) throw invalidQr();
        assertUsableAccreditation(users[0]);
        // PostgreSQL INSERT ON CONFLICT DO NOTHING waits for concurrent inserts.
        // The following READ COMMITTED statement sees the winner, preserving its
        // timestamp, circle and administrator even after a lost-response retry.
        const inserted = await tx.qrEventParticipant.createMany({
          data: [
            {
              groupId,
              userIdentityUid: users[0].identityUid,
              circleAtRegistration: users[0].circleLevel,
              registeredByIdentityUid: actor.identityUid,
            },
          ],
          skipDuplicates: true,
        });
        const participant = await tx.qrEventParticipant.findUniqueOrThrow({
          where: {
            groupId_userIdentityUid: {
              groupId,
              userIdentityUid: users[0].identityUid,
            },
          },
          include: participantInclude,
        });
        return {
          status: inserted.count ? 'registered' : 'already_registered',
          groupId,
          participant: describeParticipant(participant),
          total: await tx.qrEventParticipant.count({ where: { groupId } }),
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
      },
    );
  }
}
