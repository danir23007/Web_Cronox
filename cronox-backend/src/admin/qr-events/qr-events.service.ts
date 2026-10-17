import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, UserAccountState } from '@prisma/client';
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

  async scan(groupId: string, qrContent: string, actorId: number) {
    const token = parseAccreditationPayload(qrContent);
    const initial = await this.prisma.user.findUnique({
      where: { publicMemberToken: token },
      select: { id: true },
    });
    if (!initial) throw invalidQr();
    // Same authoritative circle rules as the profile; no circle or user ID is
    // accepted from a camera/client. Invalid circles remain invalid.
    await this.circles.maybePromoteRequestedCircle(initial.id);
    return this.prisma.$transaction(
      async (tx) => {
        const groups = await tx.$queryRaw<
          Array<{ archived: boolean }>
        >`SELECT "archived" FROM "QrEventGroup" WHERE "id"=${groupId}::uuid FOR SHARE`;
        if (!groups[0] || groups[0].archived) throw unavailable();
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
        const actor = await tx.user.findUnique({
          where: { id: actorId },
          select: { identityUid: true, role: true, accountState: true },
        });
        if (
          !actor ||
          actor.accountState !== UserAccountState.ACTIVE ||
          (actor.role !== Role.ADMIN && actor.role !== Role.SUPERADMIN)
        ) {
          throw new ForbiddenException('Permiso insuficiente');
        }
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
