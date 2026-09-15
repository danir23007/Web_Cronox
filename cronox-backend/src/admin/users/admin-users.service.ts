import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CircleUpgradeRequestStatus,
  OrderStatus,
  Prisma,
  Role,
  User,
  UserAccountState,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeCountry } from '../../common/country';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';
import { AdminUserOrdersQueryDto } from './dto/admin-user-orders-query.dto';
import { AdminUserRequestsQueryDto } from './dto/admin-user-requests-query.dto';
import { isAdminPanelRole, isSuperAdminRole } from '../../common/roles.utils';
import { UpdateAdminUserDto } from './dto/update-admin-user.dto';

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;
const RECENT_ITEMS_LIMIT = 20;
const SERIALIZABLE_RETRY_LIMIT = 3;
const PAID_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

type UserWithAddresses = Prisma.UserGetPayload<{
  include: { addresses: true };
}>;

export type AdminUserUpdateRequestMetadata = {
  ip?: string;
  userAgent?: string;
  requestId?: string;
};

type AdminUserRequestItem = {
  id: number | string;
  kind: '2-3' | '3-4';
  status: CircleUpgradeRequestStatus;
  fromCircle: number;
  toCircle: number;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: { id: number; email?: string | null } | null;
  reason: string | null;
};

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  getEditOptions() {
    return {
      roles: Object.values(Role),
      accountStates: Object.values(UserAccountState),
      circles: [1, 2, 3, 4, 5],
      circleNullable: false,
    };
  }

  async listUsers(query: AdminUserQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const skip = (page - 1) * pageSize;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort, query.order);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: items.map((user) => this.mapUser(user)),
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize) || 1,
        sort: query.sort ?? 'createdAt',
        order: query.order ?? 'desc',
      },
    };
  }

  async getUserById(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        firstName: true,
        lastName: true,
        circleLevel: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        lastLoginAt: true,
        accountState: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    const [
      ordersCount,
      totalSpent,
      requestsCount,
      recentRequests,
      recentOrders,
      codesUsed,
    ] = await this.prisma.$transaction([
      this.prisma.order.count({ where: { userId: id } }),
      this.prisma.order.aggregate({
        where: { userId: id, status: { in: PAID_STATUSES } },
        _sum: { total: true },
      }),
      this.prisma.circleUpgradeRequest.count({ where: { userId: id } }),
      this.prisma.circleUpgradeRequest.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ITEMS_LIMIT,
        select: {
          id: true,
          fromCircle: true,
          toCircle: true,
          status: true,
          socialNetwork: true,
          username: true,
          requestNumber: true,
          createdAt: true,
          updatedAt: true,
          reviewedAt: true,
          approvedAt: true,
          processedAt: true,
        },
      }),
      this.prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ITEMS_LIMIT,
        select: {
          id: true,
          status: true,
          total: true,
          currency: true,
          discountCents: true,
          promoCodeCode: true,
          trackingNumber: true,
          trackingUrl: true,
          shippingCarrier: true,
          shippedAt: true,
          deliveredAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.promoCodeRedemption.findMany({
        where: { userId: id },
        orderBy: { redeemedAt: 'desc' },
        take: RECENT_ITEMS_LIMIT,
        select: {
          redeemedAt: true,
          orderId: true,
          promoCode: {
            select: {
              code: true,
              type: true,
              value: true,
            },
          },
        },
      }),
    ]);

    const username =
      user.name ||
      [user.firstName, user.lastName].filter(Boolean).join(' ') ||
      user.email;

    return {
      user: {
        id: user.id,
        email: user.email,
        username,
        avatarUrl: null,
        circle: user.circleLevel ?? 1,
        role: user.role ?? null,
        accountState: user.accountState,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: user.lastLoginAt,
      },
      stats: {
        ordersCount,
        totalSpent: Number(totalSpent._sum.total ?? 0),
        requestsCount,
      },
      requests: recentRequests,
      orders: recentOrders.map((order) => ({
        ...order,
        total: Number(order.total ?? 0),
      })),
      codesUsed,
      circleHistory: [],
    };
  }

  async updateAdminUser(
    id: number,
    dto: UpdateAdminUserDto,
    performedById: number,
    requestMetadata: AdminUserUpdateRequestMetadata = {},
  ) {
    for (let attempt = 0; attempt < SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.user.findUnique({
              where: { id },
            });

            if (!existing) {
              throw new NotFoundException('Usuario no encontrado');
            }

            if (
              existing.updatedAt.toISOString() !==
              new Date(dto.expectedUpdatedAt).toISOString()
            ) {
              throw new ConflictException(
                'El usuario ha cambiado desde que se abrió. Recarga los datos e inténtalo de nuevo.',
              );
            }

            const targetRole = dto.role ?? existing.role;
            const targetState = dto.accountState ?? existing.accountState;
            if (
              id === performedById &&
              (!isAdminPanelRole(targetRole) ||
                targetState !== UserAccountState.ACTIVE)
            ) {
              throw new ForbiddenException(
                'No puedes retirar tu propio acceso administrativo',
              );
            }

            if (
              isSuperAdminRole(existing.role) &&
              existing.accountState === UserAccountState.ACTIVE &&
              (!isSuperAdminRole(targetRole) ||
                targetState !== UserAccountState.ACTIVE)
            ) {
              const superAdminCount = await tx.user.count({
                where: {
                  role: Role.SUPERADMIN,
                  accountState: UserAccountState.ACTIVE,
                },
              });
              if (superAdminCount <= 1) {
                throw new BadRequestException(
                  'Debe permanecer al menos un Super Admin activo',
                );
              }
            }

            if (
              isAdminPanelRole(existing.role) &&
              existing.accountState === UserAccountState.ACTIVE &&
              (!isAdminPanelRole(targetRole) ||
                targetState !== UserAccountState.ACTIVE)
            ) {
              const adminCount = await tx.user.count({
                where: {
                  role: {
                    in: [Role.SUPERADMIN, Role.ADMIN],
                  },
                  accountState: UserAccountState.ACTIVE,
                },
              });

              if (adminCount <= 1) {
                throw new BadRequestException(
                  'Debe permanecer al menos un administrador activo',
                );
              }
            }

            const currentPhone = existing.phone;
            const nextPhone =
              dto.phone === undefined
                ? currentPhone
                : this.normalizePhone(dto.phone);
            const before = {
              name: existing.name,
              phone: currentPhone,
              role: existing.role,
              accountState: existing.accountState,
              circleLevel: existing.circleLevel,
            };
            const after = {
              name: dto.name === undefined ? existing.name : dto.name,
              phone: nextPhone,
              role: targetRole,
              accountState: targetState,
              circleLevel: dto.circleLevel ?? existing.circleLevel,
            };
            const changedFields = (
              Object.keys(before) as Array<keyof typeof before>
            ).filter((field) => before[field] !== after[field]);

            if (!changedFields.length) {
              return this.mapUser(existing);
            }

            const permissionsChanged =
              before.role !== after.role ||
              before.accountState !== after.accountState;
            const updateResult = await tx.user.updateMany({
              where: { id, updatedAt: existing.updatedAt },
              data: {
                ...(before.name !== after.name ? { name: after.name } : {}),
                ...(before.phone !== after.phone ? { phone: after.phone } : {}),
                ...(before.role !== after.role ? { role: after.role } : {}),
                ...(before.accountState !== after.accountState
                  ? { accountState: after.accountState }
                  : {}),
                ...(before.circleLevel !== after.circleLevel
                  ? { circleLevel: after.circleLevel }
                  : {}),
                ...(permissionsChanged
                  ? { sessionVersion: { increment: 1 } }
                  : {}),
                updatedAt: new Date(),
              },
            });

            if (updateResult.count !== 1) {
              throw new ConflictException(
                'El usuario ha cambiado durante la edición. Recarga los datos.',
              );
            }

            await tx.auditLog.create({
              data: {
                actorId: performedById,
                action: 'admin.user.update',
                actionType: 'admin.user.update',
                targetType: 'user',
                targetId: String(id),
                fromCircle:
                  before.circleLevel !== after.circleLevel
                    ? before.circleLevel
                    : null,
                toCircle:
                  before.circleLevel !== after.circleLevel
                    ? after.circleLevel
                    : null,
                metadata: {
                  changedFields,
                  before,
                  after,
                  request: {
                    ...(requestMetadata.ip ? { ip: requestMetadata.ip } : {}),
                    ...(requestMetadata.userAgent
                      ? { userAgent: requestMetadata.userAgent }
                      : {}),
                    ...(requestMetadata.requestId
                      ? { requestId: requestMetadata.requestId }
                      : {}),
                  },
                },
              },
            });

            const updated = await tx.user.findUnique({
              where: { id },
            });
            if (!updated) throw new NotFoundException('Usuario no encontrado');

            return this.mapUser(updated);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          this.isSerializationFailure(error) &&
          attempt + 1 < SERIALIZABLE_RETRY_LIMIT
        ) {
          continue;
        }
        throw error;
      }
    }

    throw new ConflictException(
      'No se pudo actualizar el usuario de forma segura; inténtalo de nuevo',
    );
  }

  async updateUserRole(
    id: number,
    role: Role,
    performedById: number,
    expectedUpdatedAt: string,
  ) {
    return this.updateAdminUser(id, { role, expectedUpdatedAt }, performedById);
  }

  async getUserAuditLogs(userId: number, limit = 20) {
    const items = await this.prisma.auditLog.findMany({
      where: {
        OR: [
          { targetType: 'user', targetId: String(userId) },
          { metadata: { path: ['userId'], equals: userId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    return items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      adminUser: item.actor,
      actionType: item.actionType ?? item.action ?? 'UNKNOWN',
      targetType: item.targetType ?? 'unknown',
      targetId: item.targetId ?? '',
      fromCircle: item.fromCircle,
      toCircle: item.toCircle,
      reason: item.reason,
      metadata: item.metadata,
    }));
  }

  async getUserRequests(userId: number, query: AdminUserRequestsQueryDto) {
    await this.assertUserExists(userId);

    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const sort = query.sort ?? 'createdAt';
    const order = query.order ?? 'desc';
    const status = query.status;

    const kinds: Array<'2-3' | '3-4'> = query.kind
      ? [query.kind]
      : ['2-3', '3-4'];

    const requests: AdminUserRequestItem[] = [];

    if (kinds.includes('2-3')) {
      const items = await this.prisma.circleUpgradeRequest.findMany({
        where: {
          userId,
          fromCircle: 2,
          toCircle: 3,
          ...(status ? { status } : {}),
        },
        select: {
          id: true,
          status: true,
          fromCircle: true,
          toCircle: true,
          createdAt: true,
          reviewedAt: true,
          processedAt: true,
          approvedAt: true,
          notes: true,
          processedBy: { select: { id: true, email: true } },
        },
      });

      requests.push(
        ...items.map((item) => ({
          id: item.id,
          kind: '2-3' as const,
          status: item.status,
          fromCircle: item.fromCircle,
          toCircle: item.toCircle,
          createdAt: item.createdAt.toISOString(),
          resolvedAt: this.resolveRequestDate(item)?.toISOString() ?? null,
          resolvedBy: item.processedBy
            ? { id: item.processedBy.id, email: item.processedBy.email }
            : null,
          reason: item.notes ?? null,
        })),
      );
    }

    if (kinds.includes('3-4')) {
      const items = await this.prisma.circleUpgradeRequest.findMany({
        where: {
          userId,
          fromCircle: 3,
          toCircle: 4,
          ...(status ? { status } : {}),
        },
        select: {
          id: true,
          status: true,
          fromCircle: true,
          toCircle: true,
          createdAt: true,
          reviewedAt: true,
          processedAt: true,
          approvedAt: true,
          notes: true,
          processedBy: { select: { id: true, email: true } },
        },
      });

      requests.push(
        ...items.map((item) => ({
          id: item.id,
          kind: '3-4' as const,
          status: item.status,
          fromCircle: item.fromCircle,
          toCircle: item.toCircle,
          createdAt: item.createdAt.toISOString(),
          resolvedAt: this.resolveRequestDate(item)?.toISOString() ?? null,
          resolvedBy: item.processedBy
            ? { id: item.processedBy.id, email: item.processedBy.email }
            : null,
          reason: item.notes ?? null,
        })),
      );
    }

    const sorted = this.sortRequests(requests, sort, order);
    const total = sorted.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    const items = sorted.slice(start, start + pageSize);

    return {
      items,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  async getUserOrders(userId: number, query: AdminUserOrdersQueryDto) {
    await this.assertUserExists(userId);

    const page = query.page ?? 1;
    const pageSize = Math.min(
      query.pageSize ?? DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );
    const skip = (page - 1) * pageSize;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.order.count({ where: { userId } }),
    ]);

    const totalPages = Math.ceil(total / pageSize) || 1;

    return {
      items: items.map((order) => ({
        id: order.id,
        status: order.status,
        totalCents: Math.round(order.total.toNumber() * 100),
        currency: order.currency,
        createdAt: order.createdAt.toISOString(),
        itemsCount: order._count.items,
      })),
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  private buildWhere(query: AdminUserQueryDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    const search = query.q?.trim() || query.search?.trim();

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (query.email?.trim()) {
      where.email = { contains: query.email.trim(), mode: 'insensitive' };
    }

    if (query.phone?.trim()) {
      where.phone = { contains: query.phone.trim(), mode: 'insensitive' };
    }

    if (query.role) {
      where.role = query.role;
    }

    if (query.accountState) {
      where.accountState = query.accountState;
    }

    if (typeof query.circle === 'number' && Number.isFinite(query.circle)) {
      where.circleLevel = query.circle;
    }

    return where;
  }

  private isSerializationFailure(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private buildOrderBy(
    sort: AdminUserQueryDto['sort'],
    direction: AdminUserQueryDto['order'],
  ): Prisma.UserOrderByWithRelationInput {
    const order: Prisma.SortOrder =
      (direction ?? 'desc') === 'asc' ? 'asc' : 'desc';

    switch (sort) {
      case 'email':
        return { email: order };
      case 'id':
        return { id: order };
      case 'createdAt':
      default:
        return { createdAt: order };
    }
  }

  private mapUser(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      circle: user.circleLevel,
      phone: user.phone,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      accountState: user.accountState,
    };
  }

  private normalizePhone(phone: string | null): string | null {
    const trimmed = phone?.trim();
    if (!trimmed) return null;
    if (!/^\+?[\d\s()-]+$/.test(trimmed)) {
      throw new BadRequestException(
        'El teléfono debe usar un formato internacional válido con números y un único + inicial opcional',
      );
    }
    const digits = trimmed.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) {
      throw new BadRequestException(
        'El teléfono debe contener entre 6 y 15 dígitos',
      );
    }
    return trimmed.startsWith('+') ? `+${digits}` : digits;
  }

  private mapUserWithAddresses(user: UserWithAddresses) {
    return {
      ...this.mapUser(user),
      addresses: user.addresses.map((address) => ({
        id: address.id,
        name: address.name,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        state: address.state,
        zip: address.zip,
        country: normalizeCountry(address.country) ?? address.country,
        phone: address.phone,
        isDefault: address.isDefault,
        createdAt: address.createdAt,
        updatedAt: address.updatedAt,
      })),
    };
  }

  private async assertUserExists(userId: number) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('User not found');
    }
  }

  private resolveRequestDate(request: {
    processedAt?: Date | null;
    reviewedAt?: Date | null;
    approvedAt?: Date | null;
  }) {
    return (
      request.processedAt ?? request.reviewedAt ?? request.approvedAt ?? null
    );
  }

  private sortRequests(
    items: AdminUserRequestItem[],
    sort: AdminUserRequestsQueryDto['sort'],
    order: AdminUserRequestsQueryDto['order'],
  ) {
    const direction = order === 'asc' ? 1 : -1;

    return [...items].sort((a, b) => {
      if (sort === 'status') {
        return a.status.localeCompare(b.status) * direction;
      }

      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return (aTime - bTime) * direction;
    });
  }
}
