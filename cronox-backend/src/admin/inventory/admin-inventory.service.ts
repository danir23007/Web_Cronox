import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { availableStock, classifyStock } from '../../common/stock-status';
import {
  INVENTORY_AUDIT_ACTION,
  INVENTORY_AUDIT_TARGET,
  INVENTORY_LOW_STOCK_THRESHOLD,
  INVENTORY_MANUAL_REASON,
} from './inventory.constants';
import {
  AdminInventoryHistoryQueryDto,
  AdminInventoryQueryDto,
} from './dto/admin-inventory-query.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

const DEFAULT_PAGE_SIZE = 20;

const productSelect = {
  id: true,
  name: true,
  slug: true,
  imageUrl: true,
  isActive: true,
  images: {
    where: { isActive: true },
    select: { url: true, alt: true, isPrimary: true, sortOrder: true },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
    take: 1,
  },
  variants: {
    select: {
      id: true,
      size: true,
      sku: true,
      stockQty: true,
      isActive: true,
      updatedAt: true,
    },
    orderBy: [{ size: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ProductSelect;

type InventoryProduct = Prisma.ProductGetPayload<{
  select: typeof productSelect;
}>;

@Injectable()
export class AdminInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminInventoryQueryDto) {
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? DEFAULT_PAGE_SIZE, 100);
    const where = await this.buildProductWhere(query);
    const [products, totalItems] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        select: productSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      items: products.map((product) => this.mapProduct(product)),
      meta: { page, pageSize, totalItems, totalPages },
      lowStockThreshold: INVENTORY_LOW_STOCK_THRESHOLD,
    };
  }

  async summary() {
    const [row] = await this.prisma.$queryRaw<
      Array<{
        totalUnits: bigint;
        productsWithStock: bigint;
        soldOutProducts: bigint;
        lowStockVariants: bigint;
      }>
    >(Prisma.sql`
      SELECT
        COALESCE((SELECT SUM(GREATEST(v."stock", 0)) FROM "ProductVariant" v WHERE v."isActive"), 0)::bigint AS "totalUnits",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "ProductVariant" v
            WHERE v."productId" = p.id AND v."isActive" AND v."stock" > 0
          )
        )::bigint AS "productsWithStock",
        COUNT(*) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM "ProductVariant" v
            WHERE v."productId" = p.id AND v."isActive" AND v."stock" > 0
          )
        )::bigint AS "soldOutProducts",
        (SELECT COUNT(*) FROM "ProductVariant" v
          WHERE v."isActive" AND v."stock" > 0 AND v."stock" <= ${INVENTORY_LOW_STOCK_THRESHOLD}
        )::bigint AS "lowStockVariants"
      FROM "Product" p
    `);

    return {
      totalUnits: Number(row?.totalUnits ?? 0),
      productsWithStock: Number(row?.productsWithStock ?? 0),
      soldOutProducts: Number(row?.soldOutProducts ?? 0),
      lowStockVariants: Number(row?.lowStockVariants ?? 0),
      lowStockThreshold: INVENTORY_LOW_STOCK_THRESHOLD,
    };
  }

  async getProduct(productId: number) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: productSelect,
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');
    return this.mapProduct(product);
  }

  async update(productId: number, dto: UpdateInventoryDto, adminId?: number) {
    const ids = dto.updates.map((update) => update.variantId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('DUPLICATE_VARIANT_ID');
    }
    const updates = [...dto.updates].sort(
      (left, right) => left.variantId - right.variantId,
    );
    const reason = dto.reason?.trim() || INVENTORY_MANUAL_REASON;

    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });
      if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

      const variants = await tx.productVariant.findMany({
        where: { id: { in: ids }, productId },
        select: { id: true, size: true, sku: true, stockQty: true },
        orderBy: { id: 'asc' },
      });
      if (variants.length !== ids.length) {
        throw new BadRequestException('VARIANT_DOES_NOT_BELONG_TO_PRODUCT');
      }
      const byId = new Map(variants.map((variant) => [variant.id, variant]));

      for (const update of updates) {
        const before = byId.get(update.variantId)!;
        const changed = await tx.productVariant.updateMany({
          where: {
            id: update.variantId,
            productId,
            stockQty: update.expectedStock,
          },
          data: { stockQty: update.stock },
        });
        if (changed.count !== 1) {
          throw new ConflictException({
            code: 'INVENTORY_STALE_STOCK',
            message:
              'El stock ha cambiado. Recarga el producto antes de guardar.',
            variantId: update.variantId,
          });
        }

        const delta = update.stock - before.stockQty;
        if (delta === 0) continue;
        const movement = await tx.stockMovement.create({
          data: {
            variantId: update.variantId,
            delta,
            reason,
            userId: adminId,
          },
          select: { id: true },
        });
        await tx.auditLog.create({
          data: {
            actorId: adminId,
            action: 'Actualización manual de inventario',
            actionType: INVENTORY_AUDIT_ACTION,
            targetType: INVENTORY_AUDIT_TARGET,
            targetId: String(update.variantId),
            reason,
            metadata: {
              productId,
              variantId: update.variantId,
              size: before.size,
              sku: before.sku,
              previousStock: before.stockQty,
              newStock: update.stock,
              delta,
              movementId: movement.id,
            },
          },
        });
      }
    });

    return this.getProduct(productId);
  }

  async history(productId: number, query: AdminInventoryHistoryQueryDto) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, variants: { select: { id: true } } },
    });
    if (!product) throw new NotFoundException('PRODUCT_NOT_FOUND');

    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 10, 100);
    const variantIds = product.variants.map((variant) => String(variant.id));
    const where: Prisma.AuditLogWhereInput = {
      actionType: INVENTORY_AUDIT_ACTION,
      targetType: INVENTORY_AUDIT_TARGET,
      targetId: { in: variantIds },
    };
    const [logs, totalItems] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          reason: true,
          metadata: true,
          actor: { select: { id: true, name: true, email: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: logs.map((log) => ({
        id: log.id,
        createdAt: log.createdAt.toISOString(),
        reason: log.reason,
        ...(this.asMetadata(log.metadata) ?? {}),
        admin: log.actor,
      })),
      meta: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
      },
    };
  }

  private async buildProductWhere(
    query: AdminInventoryQueryDto,
  ): Promise<Prisma.ProductWhereInput> {
    const where: Prisma.ProductWhereInput = {};
    const search = query.search?.trim();
    if (search) {
      const numericId = /^\d+$/.test(search) ? Number(search) : undefined;
      where.OR = [
        ...(numericId && Number.isSafeInteger(numericId)
          ? [{ id: numericId }]
          : []),
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        {
          variants: {
            some: { sku: { contains: search, mode: 'insensitive' } },
          },
        },
      ];
    }
    if (query.isActive === 'true') where.isActive = true;
    if (query.isActive === 'false') where.isActive = false;
    if (query.stockStatus) {
      const ids = await this.productIdsForStockStatus(query.stockStatus);
      where.id = { in: ids };
    }
    return where;
  }

  private async productIdsForStockStatus(
    status: NonNullable<AdminInventoryQueryDto['stockStatus']>,
  ) {
    const total = Prisma.sql`COALESCE(SUM(CASE WHEN v."isActive" THEN GREATEST(v."stock", 0) ELSE 0 END), 0)`;
    const condition =
      status === 'in_stock'
        ? Prisma.sql`${total} > 0`
        : status === 'low'
          ? Prisma.sql`${total} > 0 AND ${total} <= ${INVENTORY_LOW_STOCK_THRESHOLD}`
          : Prisma.sql`${total} = 0`;
    const rows = await this.prisma.$queryRaw<Array<{ id: number }>>(Prisma.sql`
      SELECT p.id
      FROM "Product" p
      LEFT JOIN "ProductVariant" v ON v."productId" = p.id
      GROUP BY p.id
      HAVING ${condition}
    `);
    return rows.map((row) => row.id);
  }

  private mapProduct(product: InventoryProduct) {
    const totalStock = availableStock(product.variants);
    return {
      ...product,
      imageUrl:
        product.images.find((image) => image.isPrimary)?.url ??
        product.images[0]?.url ??
        product.imageUrl,
      totalStock,
      variantCount: product.variants.length,
      stockStatus: classifyStock(totalStock),
      variants: product.variants.map((variant) => ({
        ...variant,
        stock: variant.stockQty,
        status:
          variant.stockQty === 0
            ? 'out_of_stock'
            : variant.stockQty <= INVENTORY_LOW_STOCK_THRESHOLD
              ? 'low'
              : 'in_stock',
      })),
    };
  }

  private asMetadata(value: Prisma.JsonValue): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }
}
