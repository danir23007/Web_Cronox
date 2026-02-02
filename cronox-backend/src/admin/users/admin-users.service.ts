import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma, Role, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminUserQueryDto } from './dto/admin-user-query.dto';

const DEFAULT_PAGE_SIZE = 20;
const RECENT_ITEMS_LIMIT = 20;
const PAID_STATUSES: OrderStatus[] = [OrderStatus.PAID, OrderStatus.SHIPPED];

type UserWithAddresses = Prisma.UserGetPayload<{
  include: { addresses: true };
}>;

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listUsers(query: AdminUserQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, 100);
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
        pageCount: Math.ceil(total / pageSize) || 1,
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
        firstName: true,
        lastName: true,
        circleLevel: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [ordersCount, totalSpent, requestsCount, recentRequests, recentOrders, codesUsed] =
      await this.prisma.$transaction([
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
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastLoginAt: null,
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

  async updateUserRole(id: number, role: Role, performedById: number) {
    if (id === performedById && role !== Role.ADMIN) {
      throw new ForbiddenException('Cannot remove your own admin role');
    }

    const existing = await this.prisma.user.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException('User not found');
    }

    if (existing.role === role) {
      return this.mapUser(existing);
    }

    if (existing.role === Role.ADMIN && role !== Role.ADMIN) {
      const adminCount = await this.prisma.user.count({ where: { role: Role.ADMIN } });

      if (adminCount <= 1) {
        throw new BadRequestException('At least one admin user must remain');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: { role },
    });

    return this.mapUser(updated);
  }

  private buildWhere(query: AdminUserQueryDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    const search = query.search?.trim();

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private buildOrderBy(
    sort: AdminUserQueryDto['sort'],
    direction: AdminUserQueryDto['order'],
  ): Prisma.UserOrderByWithRelationInput {
    const order: Prisma.SortOrder = (direction ?? 'desc') === 'asc' ? 'asc' : 'desc';

    switch (sort) {
      case 'email':
        return { email: order };
      case 'name':
        return { name: order };
      case 'role':
        return { role: order };
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
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
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
        country: address.country,
        phone: address.phone,
        isDefault: address.isDefault,
        createdAt: address.createdAt,
        updatedAt: address.updatedAt,
      })),
    };
  }
}
