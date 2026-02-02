import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditLogQueryDto } from './dto/admin-audit-log-query.dto';

const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class AdminAuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminAuditLogQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, 100);
    const skip = (page - 1) * pageSize;

    const where: Prisma.AuditLogWhereInput = {};

    if (query.actionType) {
      where.actionType = query.actionType;
    }

    if (query.targetType) {
      where.targetType = query.targetType;
    }

    if (query.dateFrom || query.dateTo) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (query.dateFrom) {
        const fromDate = new Date(query.dateFrom);
        if (!Number.isNaN(fromDate.getTime())) {
          createdAt.gte = fromDate;
        }
      }
      if (query.dateTo) {
        const toDate = new Date(query.dateTo);
        if (!Number.isNaN(toDate.getTime())) {
          createdAt.lte = toDate;
        }
      }
      if (Object.keys(createdAt).length) {
        where.createdAt = createdAt;
      }
    }

    const search = query.q?.trim();
    if (search) {
      where.OR = [
        { targetId: { contains: search, mode: 'insensitive' } },
        { actor: { email: { contains: search, mode: 'insensitive' } } },
        { actor: { name: { contains: search, mode: 'insensitive' } } },
        { actor: { firstName: { contains: search, mode: 'insensitive' } } },
        { actor: { lastName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
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
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      items: items.map((item) => ({
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
      })),
      page,
      pageSize,
      totalItems,
      totalPages,
    };
  }

  async listForUser(userId: number, limit = 20) {
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
}
