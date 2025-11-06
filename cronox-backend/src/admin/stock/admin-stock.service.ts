import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminStockMovementsQueryDto } from './dto/admin-stock-movements-query.dto';

const DEFAULT_PAGE_SIZE = 25;

type StockMovementWithRelations = Prisma.StockMovementGetPayload<{
  include: {
    variant: {
      select: {
        id: true;
        sku: true;
        size: true;
        product: {
          select: {
            id: true;
            name: true;
          };
        };
      };
    };
    user: {
      select: {
        id: true;
        email: true;
        name: true;
      };
    };
  };
}>;

@Injectable()
export class AdminStockService {
  constructor(private readonly prisma: PrismaService) {}

  async listMovements(query: AdminStockMovementsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, 100);
    const skip = (page - 1) * pageSize;

    const where = this.buildWhere(query);
    const orderBy = this.buildOrderBy(query.sort, query.order);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy,
        include: {
          variant: {
            select: {
              id: true,
              sku: true,
              size: true,
              product: { select: { id: true, name: true } },
            },
          },
          user: { select: { id: true, email: true, name: true } },
        },
      }),
      this.prisma.stockMovement.count({ where }),
    ]);

    return {
      data: items.map((movement) => this.mapMovement(movement)),
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

  private buildWhere(
    query: AdminStockMovementsQueryDto,
  ): Prisma.StockMovementWhereInput {
    const where: Prisma.StockMovementWhereInput = {};

    if (query.variantId) {
      where.variantId = query.variantId;
    }

    if (query.productId) {
      where.variant = { productId: query.productId };
    }

    if (query.reason?.trim()) {
      where.reason = { contains: query.reason.trim(), mode: 'insensitive' };
    }

    const dateFilters: Prisma.DateTimeFilter = {};

    if (query.dateFrom) {
      const date = this.parseDate(query.dateFrom);
      if (date) {
        dateFilters.gte = date;
      }
    }

    if (query.dateTo) {
      const date = this.parseDate(query.dateTo);
      if (date) {
        dateFilters.lte = date;
      }
    }

    if (Object.keys(dateFilters).length) {
      where.createdAt = dateFilters;
    }

    return where;
  }

  private buildOrderBy(
    sort: AdminStockMovementsQueryDto['sort'],
    direction: AdminStockMovementsQueryDto['order'],
  ): Prisma.StockMovementOrderByWithRelationInput {
    const order: Prisma.SortOrder = (direction ?? 'desc') === 'asc' ? 'asc' : 'desc';

    switch (sort) {
      case 'delta':
        return { delta: order };
      case 'createdAt':
      default:
        return { createdAt: order };
    }
  }

  private mapMovement(movement: StockMovementWithRelations) {
    return {
      id: movement.id,
      variantId: movement.variantId,
      delta: movement.delta,
      reason: movement.reason,
      createdAt: movement.createdAt.toISOString(),
      product: movement.variant.product
        ? {
            id: movement.variant.product.id,
            name: movement.variant.product.name,
          }
        : undefined,
      variant: {
        id: movement.variant.id,
        sku: movement.variant.sku,
        size: movement.variant.size,
      },
      user: movement.user
        ? {
            id: movement.user.id,
            email: movement.user.email,
            name: movement.user.name,
          }
        : null,
    };
  }

  private parseDate(value: string): Date | undefined {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
}
