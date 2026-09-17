import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma, VariantSize } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import {
  GalleryImageItemDto,
  UpdateProductDto,
} from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { AdjustStockDto, UpdateVariantDto } from './dto/update-variant.dto';
import { CreateProductImageDto } from './dto/create-product-image.dto';
import { AdminProductQueryDto } from '../admin/products/dto/admin-product-query.dto';
import { ProductSuggestionsQueryDto } from './dto/product-suggestions-query.dto';
import {
  buildProductSearchText,
  expandSearchTokens,
  normalizeSearchKeywords,
  normalizeSearchText,
  scoreProductSearch,
} from './product-search';
import { createHash, randomUUID } from 'crypto';
import { SupabaseStorageService } from '../common/storage/supabase-storage.service';

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly storage?: SupabaseStorageService,
  ) {}

  private readonly defaultSizes: VariantSize[] = [
    VariantSize.XS,
    VariantSize.S,
    VariantSize.M,
    VariantSize.L,
    VariantSize.XL,
    VariantSize.XXL,
  ];

  private readonly imageOrderBy: Prisma.ProductImageOrderByWithRelationInput[] =
    [{ sortOrder: 'asc' }, { id: 'asc' }];

  private readonly variantOrderBy: Prisma.ProductVariantOrderByWithRelationInput[] =
    [{ id: 'asc' }];

  private productCreateHash(dto: CreateProductDto): string {
    const normalize = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalize);
      if (value && typeof value === 'object') {
        return Object.keys(value as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((result, key) => {
            result[key] = normalize((value as Record<string, unknown>)[key]);
            return result;
          }, {});
      }
      return value;
    };
    return createHash('sha256')
      .update(JSON.stringify(normalize(dto)))
      .digest('hex');
  }

  private validateIdempotencyKey(value?: string): string {
    const key = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,99}$/.test(key)) {
      throw new BadRequestException(
        'La cabecera Idempotency-Key es obligatoria y no es válida.',
      );
    }
    return key;
  }

  private async lockProductOrder(tx: Prisma.TransactionClient) {
    // Prisma always exposes this in production. The runtime guard keeps the
    // service compatible with the project's lightweight transaction fakes.
    if (typeof tx.$executeRaw === 'function') {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(435276901)`;
    }
  }

  private slugify(value: string) {
    return (value || '')
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 140);
  }

  private buildPublicSearchWhere(
    search: string,
    categorySlug?: string,
  ): Prisma.ProductWhereInput {
    const tokenGroups = expandSearchTokens(search);
    const filters: Prisma.ProductWhereInput[] = [];

    if (categorySlug) {
      filters.push({
        categories: {
          some: {
            category: { slug: categorySlug, isActive: true },
          },
        },
      });
    }

    for (const terms of tokenGroups) {
      filters.push({
        OR: terms.flatMap((term) => [
          { searchText: { contains: term } },
          {
            categories: {
              some: {
                category: {
                  isActive: true,
                  OR: [
                    { name: { contains: term, mode: 'insensitive' as const } },
                    { slug: { contains: term, mode: 'insensitive' as const } },
                  ],
                },
              },
            },
          },
        ]),
      });
    }

    return {
      isActive: true,
      ...(filters.length ? { AND: filters } : {}),
    };
  }

  private toPublicProduct<
    T extends {
      price: number;
      searchKeywords: string[];
      searchText: string;
      variants?: { price: number | null }[];
    },
  >(product: T) {
    const publicProduct = { ...product } as Omit<
      T,
      'searchKeywords' | 'searchText'
    > & {
      searchKeywords?: string[];
      searchText?: string;
    };
    delete publicProduct.searchKeywords;
    delete publicProduct.searchText;
    const publicImages = (
      publicProduct as { images?: Array<{ isPrimary?: boolean }> }
    ).images;
    if (Array.isArray(publicImages)) {
      publicImages.sort(
        (left, right) =>
          Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)),
      );
    }
    return this.addEffectiveVariantPrices(publicProduct);
  }

  private async ensureUniqueSlug(
    base: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
    excludeProductId?: number,
  ): Promise<string> {
    const normalized = this.slugify(base) || `producto-${Date.now()}`;
    let candidate = normalized;
    let suffix = 2;

    while (true) {
      const existing = await tx.product.findFirst({
        where: {
          slug: candidate,
          ...(excludeProductId ? { id: { not: excludeProductId } } : {}),
        },
        select: { id: true },
      });

      if (!existing) {
        return candidate;
      }

      candidate = `${normalized}-${suffix}`;
      suffix += 1;
    }
  }

  private prepareImages(dto: {
    images?: CreateProductImageDto[];
    imageUrls?: string[];
  }) {
    const fromDto = Array.isArray(dto.images) ? dto.images : [];
    const fromUrls =
      Array.isArray(dto.imageUrls) && dto.imageUrls.length
        ? dto.imageUrls.map((url, index) => ({
            url,
            sortOrder: index,
            isPrimary: index === 0,
          }))
        : [];

    let images = [...fromDto, ...fromUrls];

    if (images.length > 0 && !images.some((image) => image.isPrimary)) {
      images = images.map((image, index) => ({
        ...image,
        isPrimary: index === 0,
      }));
    }

    return images;
  }

  private galleryImageData(image: GalleryImageItemDto) {
    return {
      url: image.url,
      alt: image.alt?.trim() ?? '',
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
      isActive: image.isActive,
      galleryPositionX: image.galleryPositionX,
      galleryPositionY: image.galleryPositionY,
      galleryZoom: image.galleryZoom,
      galleryFit: image.galleryFit,
      archivedAt: image.isActive ? null : new Date(),
      deletionState: null,
    };
  }

  private validateGallery(images: GalleryImageItemDto[]) {
    const ids = images.flatMap((image) => (image.id ? [image.id] : []));
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException(
        'La galerÃ­a contiene imÃ¡genes duplicadas.',
      );
    }
    const urls = images.map((image) => image.url);
    if (new Set(urls).size !== urls.length) {
      throw new BadRequestException(
        'La galerÃ­a contiene archivos duplicados.',
      );
    }
    const active = images.filter((image) => image.isActive);
    if (!active.length && images.length) {
      throw new BadRequestException(
        'El producto debe conservar al menos una imagen activa.',
      );
    }
    if (
      active.filter((image) => image.isPrimary).length !==
      (active.length ? 1 : 0)
    ) {
      throw new BadRequestException(
        'La galerÃ­a debe tener exactamente una imagen principal.',
      );
    }
    const ordered = [...active].sort((a, b) => a.sortOrder - b.sortOrder);
    if (ordered.some((image, index) => image.sortOrder !== index)) {
      throw new BadRequestException(
        'El orden de la galerÃ­a debe ser consecutivo y sin duplicados.',
      );
    }
    if (ordered[0] && !ordered[0].isPrimary) {
      throw new BadRequestException(
        'La imagen principal debe ocupar la primera posiciÃ³n.',
      );
    }
  }

  private buildDefaultVariants(): CreateVariantDto[] {
    return this.defaultSizes.map((size) => ({
      size,
      stockQty: 0,
      isActive: true,
    }));
  }

  private resolveVariantSku(
    productSlug: string,
    variant: Pick<CreateVariantDto, 'size' | 'sku'>,
  ): string {
    if (typeof variant.sku === 'string' && variant.sku.trim().length > 0) {
      return variant.sku;
    }

    const slug = this.slugify(productSlug) || 'producto';
    const size = String(variant.size).toLowerCase();
    const suffix = randomUUID().replace(/-/g, '');
    return `${slug}-${size}-${suffix}`;
  }

  private async recordAudit(
    action: string,
    metadata: Prisma.InputJsonValue,
    adminId?: number,
    tx?: Prisma.TransactionClient,
  ) {
    const client = tx ?? this.prisma;
    try {
      await client.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action,
          metadata,
        },
      });
    } catch (error) {
      // No bloquear la operación principal por fallo en auditoría
      console.warn('[AUDIT_LOG] Error registrando auditoría', error);
    }
  }

  private getProductInclude(options?: {
    includeInactiveVariants?: boolean;
    includeArchivedImages?: boolean;
  }): Prisma.ProductInclude {
    const variantArgs: Prisma.ProductVariantFindManyArgs = {
      orderBy: this.variantOrderBy,
    };

    if (!options?.includeInactiveVariants) {
      variantArgs.where = { isActive: true };
    }

    return {
      images: {
        where: options?.includeArchivedImages ? undefined : { isActive: true },
        orderBy: this.imageOrderBy,
      },
      variants: variantArgs,
      categories: {
        orderBy: { id: 'asc' },
        include: { category: true },
      },
    };
  }

  private async getProductIdsByStockState(
    stockState: AdminProductQueryDto['stockState'],
    lowStockThreshold: number,
  ): Promise<number[]> {
    if (!stockState) return [];

    const totalStockExpr = Prisma.sql`COALESCE(SUM(v."stock"), 0)`;
    let condition: Prisma.Sql;

    if (stockState === 'low') {
      condition = Prisma.sql`${totalStockExpr} > 0 AND ${totalStockExpr} <= ${lowStockThreshold}`;
    } else if (stockState === 'in_stock') {
      condition = Prisma.sql`${totalStockExpr} > 0`;
    } else {
      condition = Prisma.sql`${totalStockExpr} <= 0`;
    }

    const rows = await this.prisma.$queryRaw<{ product_id: number }[]>(
      Prisma.sql`
        SELECT p.id as product_id
        FROM "Product" p
        LEFT JOIN "ProductVariant" v ON v."productId" = p.id
        GROUP BY p.id
        HAVING ${condition}
      `,
    );

    return rows.map((row) => row.product_id);
  }

  private buildStockSortSqlFilters({
    searchTerm,
    query,
    lowStockThreshold,
  }: {
    searchTerm?: string;
    query: AdminProductQueryDto;
    lowStockThreshold: number;
  }) {
    const filters: Prisma.Sql[] = [];

    if (query.isActive === 'true') {
      filters.push(Prisma.sql`p."isActive" = true`);
    } else if (query.isActive === 'false') {
      filters.push(Prisma.sql`p."isActive" = false`);
    }

    if (query.dateFrom) {
      filters.push(Prisma.sql`p."createdAt" >= ${new Date(query.dateFrom)}`);
    }

    if (query.dateTo) {
      filters.push(Prisma.sql`p."createdAt" <= ${new Date(query.dateTo)}`);
    }

    if (query.categoryId) {
      filters.push(
        Prisma.sql`
          EXISTS (
            SELECT 1
            FROM "ProductCategory" pc
            WHERE pc."productId" = p.id
              AND pc."categoryId" = ${query.categoryId}
          )
        `,
      );
    } else if (query.category?.trim()) {
      const categoryTerm = `%${query.category.trim()}%`;
      filters.push(
        Prisma.sql`
          EXISTS (
            SELECT 1
            FROM "ProductCategory" pc
            JOIN "Category" c ON c.id = pc."categoryId"
            WHERE pc."productId" = p.id
              AND (c."name" ILIKE ${categoryTerm} OR c."slug" ILIKE ${categoryTerm})
          )
        `,
      );
    }

    if (searchTerm) {
      const likeTerm = `%${searchTerm}%`;
      filters.push(
        Prisma.sql`
          (
            p."name" ILIKE ${likeTerm}
            OR p."slug" ILIKE ${likeTerm}
            OR p."description" ILIKE ${likeTerm}
            OR p."collection" ILIKE ${likeTerm}
            OR p."searchText" ILIKE ${likeTerm}
            OR EXISTS (
              SELECT 1
              FROM "ProductVariant" v_search
              WHERE v_search."productId" = p.id
                AND v_search."sku" ILIKE ${likeTerm}
            )
            OR EXISTS (
              SELECT 1
              FROM "ProductCategory" pc_search
              JOIN "Category" c_search ON c_search.id = pc_search."categoryId"
              WHERE pc_search."productId" = p.id
                AND (c_search."name" ILIKE ${likeTerm} OR c_search."slug" ILIKE ${likeTerm})
            )
          )
        `,
      );
    }

    // ✅ FIX: Prisma.join separador como string (en tu versión TS lo exige así)
    const AND = ' AND ';

    const whereClause = filters.length
      ? Prisma.sql`WHERE ${Prisma.join(filters, AND)}`
      : Prisma.sql``;

    const stockTotalExpr = Prisma.sql`COALESCE(SUM(v."stock"), 0)`;
    const havingFilters: Prisma.Sql[] = [];

    if (query.stockState === 'low') {
      havingFilters.push(
        Prisma.sql`${stockTotalExpr} > 0 AND ${stockTotalExpr} <= ${lowStockThreshold}`,
      );
    } else if (query.stockState === 'in_stock') {
      havingFilters.push(Prisma.sql`${stockTotalExpr} > 0`);
    } else if (query.stockState === 'out_of_stock') {
      havingFilters.push(Prisma.sql`${stockTotalExpr} <= 0`);
    }

    const havingClause = havingFilters.length
      ? Prisma.sql`HAVING ${Prisma.join(havingFilters, AND)}`
      : Prisma.sql``;

    return { whereClause, havingClause, stockTotalExpr };
  }

  private addEffectiveVariantPrices<
    T extends { price: number; variants?: { price: number | null }[] },
  >(product: T): T;
  private addEffectiveVariantPrices<
    T extends { price: number; variants?: { price: number | null }[] },
  >(product: T | null): T | null;
  private addEffectiveVariantPrices<
    T extends { price: number; variants?: { price: number | null }[] },
  >(product: T | null): T | null {
    if (!product || !product.variants) {
      return product;
    }

    return {
      ...product,
      variants: product.variants.map((variant) => ({
        ...variant,
        effectivePrice: variant.price ?? product.price,
      })),
    } as T;
  }

  private handleDuplicateError(
    error: Prisma.PrismaClientKnownRequestError,
  ): never {
    const target = (error.meta?.target as string[]) ?? [];

    if (target.includes('slug')) {
      throw new ConflictException('Slug already exists');
    }

    if (target.includes('sku') || target.includes('productId_size')) {
      throw new ConflictException('Variant already exists for this product');
    }

    throw new ConflictException('Duplicate record already exists');
  }

  private buildVariantResponse(
    variant: Prisma.ProductVariantGetPayload<{
      include: { product: { select: { price: true } } };
    }>,
  ) {
    const { product, ...variantData } = variant;

    return {
      ...variantData,
      stock: variantData.stockQty, // [STOCK]
      effectivePrice: variantData.price ?? product.price,
    };
  }

  async listAdminProducts(query: AdminProductQueryDto) {
    const LOW_STOCK_THRESHOLD = 5;
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(query.pageSize ?? query.limit ?? 20, 100);
    const searchTerm = (query.q ?? query.search)?.trim();
    const sortBy = query.sortBy ?? 'createdAt';
    const sortDir = query.sortDir ?? 'desc';
    const isStockSort = sortBy === 'stock';
    const createdAtFilter: Prisma.DateTimeFilter = {};
    const andFilters: Prisma.ProductWhereInput[] = [];
    const where: Prisma.ProductWhereInput = {};

    if (query.dateFrom) createdAtFilter.gte = new Date(query.dateFrom);
    if (query.dateTo) createdAtFilter.lte = new Date(query.dateTo);
    if (Object.keys(createdAtFilter).length) {
      andFilters.push({ createdAt: createdAtFilter });
    }

    if (query.categoryId) {
      andFilters.push({
        categories: {
          some: {
            categoryId: query.categoryId,
          },
        },
      });
    } else if (query.category?.trim()) {
      const categoryTerm = query.category.trim();
      andFilters.push({
        categories: {
          some: {
            category: {
              OR: [
                { name: { contains: categoryTerm, mode: 'insensitive' } },
                { slug: { contains: categoryTerm, mode: 'insensitive' } },
              ],
            },
          },
        },
      });
    }

    if (andFilters.length) {
      where.AND = andFilters;
    }

    if (searchTerm) {
      where.OR = [
        { name: { contains: searchTerm, mode: 'insensitive' } },
        { slug: { contains: searchTerm, mode: 'insensitive' } },
        { description: { contains: searchTerm, mode: 'insensitive' } },
        { collection: { contains: searchTerm, mode: 'insensitive' } },
        { searchText: { contains: normalizeSearchText(searchTerm) } },
        {
          variants: {
            some: {
              sku: { contains: searchTerm, mode: 'insensitive' },
            },
          },
        },
        {
          categories: {
            some: {
              category: {
                OR: [
                  { name: { contains: searchTerm, mode: 'insensitive' } },
                  { slug: { contains: searchTerm, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      ];
    }

    if (query.isActive === 'true') {
      where.isActive = true;
    } else if (query.isActive === 'false') {
      where.isActive = false;
    }

    if (query.stockState && !isStockSort) {
      const stockProductIds = await this.getProductIdsByStockState(
        query.stockState,
        LOW_STOCK_THRESHOLD,
      );
      if (!stockProductIds.length) {
        return {
          items: [],
          page,
          pageSize,
          totalItems: 0,
          totalPages: 1,
          meta: {
            page,
            limit: pageSize,
            total: 0,
            pageCount: 1,
          },
        };
      }
      where.id = { in: stockProductIds };
    }

    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [];
    if (!isStockSort) {
      orderBy.push({ createdAt: sortDir });
      orderBy.push({ id: 'asc' });
    }

    const productSelect: Prisma.ProductSelect = {
      id: true,
      name: true,
      slug: true,
      description: true,
      price: true,
      currency: true,
      imageUrl: true,
      isActive: true,
      displayOrder: true,
      collection: true,
      searchKeywords: true,
      createdAt: true,
      updatedAt: true,
      images: {
        where: { isActive: true },
        select: {
          id: true,
          url: true,
          alt: true,
          sortOrder: true,
          isPrimary: true,
        },
        orderBy: this.imageOrderBy,
      },
      variants: {
        select: {
          id: true,
          size: true,
          sku: true,
          price: true,
          stockQty: true,
          isActive: true,
        },
        orderBy: this.variantOrderBy,
      },
      categories: {
        select: {
          categoryId: true,
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
            },
          },
        },
        orderBy: { categoryId: 'asc' },
      },
    };

    const skip = (page - 1) * pageSize;

    if (isStockSort) {
      const { whereClause, havingClause, stockTotalExpr } =
        this.buildStockSortSqlFilters({
          searchTerm,
          query,
          lowStockThreshold: LOW_STOCK_THRESHOLD,
        });

      // Prisma no soporta ordenar por agregados con LEFT JOIN preservando productos sin variantes.
      const orderedRows = await this.prisma.$queryRaw<{ id: number }[]>(
        Prisma.sql`
          SELECT p.id
          FROM "Product" p
          LEFT JOIN "ProductVariant" v ON v."productId" = p.id
          ${whereClause}
          GROUP BY p.id
          ${havingClause}
          ORDER BY ${stockTotalExpr} ${Prisma.raw(sortDir)}, p."createdAt" DESC, p.id ASC
          OFFSET ${skip}
          LIMIT ${pageSize}
        `,
      );

      const totalRows = await this.prisma.$queryRaw<{ total: number }[]>(
        Prisma.sql`
          SELECT COUNT(*)::int AS total
          FROM (
            SELECT p.id
            FROM "Product" p
            LEFT JOIN "ProductVariant" v ON v."productId" = p.id
            ${whereClause}
            GROUP BY p.id
            ${havingClause}
          ) AS filtered
        `,
      );

      const totalItems = totalRows[0]?.total ?? 0;
      if (!orderedRows.length) {
        return {
          items: [],
          page,
          pageSize,
          totalItems,
          totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
          meta: {
            page,
            limit: pageSize,
            total: totalItems,
            pageCount: Math.max(1, Math.ceil(totalItems / pageSize)),
          },
        };
      }

      const orderedIds = orderedRows.map((row) => row.id);
      const items = await this.prisma.product.findMany({
        where: {
          ...where,
          id: { in: orderedIds },
        },
        select: productSelect,
      });
      const itemById = new Map(items.map((item) => [item.id, item]));
      const orderedItems = orderedIds
        .map((id) => itemById.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      return {
        items: orderedItems.map((product) =>
          this.addEffectiveVariantPrices(product),
        ),
        page,
        pageSize,
        totalItems,
        totalPages,
        meta: {
          page,
          limit: pageSize,
          total: totalItems,
          pageCount: totalPages,
        },
      };
    }

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: pageSize,
        select: productSelect,
      }),
      this.prisma.product.count({ where }),
    ]);

    const pagedItems = items.map((product) =>
      this.addEffectiveVariantPrices(product),
    );
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    return {
      items: pagedItems,
      page,
      pageSize,
      totalItems,
      totalPages,
      meta: {
        page,
        limit: pageSize,
        total: totalItems,
        pageCount: totalPages,
      },
    };
  }

  async getProductOrder() {
    const items = await this.prisma.product.findMany({
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        displayOrder: true,
        imageUrl: true,
        images: {
          where: { isActive: true },
          orderBy: this.imageOrderBy,
          take: 1,
          select: { url: true },
        },
      },
    });
    return { items };
  }

  async reorderProducts(productIds: number[], adminId?: number) {
    if (!Array.isArray(productIds) || !productIds.length) {
      throw new BadRequestException('PRODUCT_ORDER_REQUIRED');
    }
    if (
      productIds.some((id) => !Number.isInteger(id) || id < 1) ||
      new Set(productIds).size !== productIds.length
    ) {
      throw new BadRequestException('PRODUCT_ORDER_IDS_INVALID_OR_DUPLICATED');
    }

    return this.prisma.$transaction(async (tx) => {
      // Serializes reorders and product creation so two admins cannot produce
      // a partial or internally inconsistent sequence.
      await this.lockProductOrder(tx);
      const existing = await tx.product.findMany({
        select: { id: true },
        orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      });
      const existingIds = new Set(existing.map(({ id }) => id));
      const missing = existing
        .map(({ id }) => id)
        .filter((id) => !productIds.includes(id));
      const unknown = productIds.filter((id) => !existingIds.has(id));
      if (
        missing.length ||
        unknown.length ||
        productIds.length !== existing.length
      ) {
        throw new BadRequestException({
          code: 'PRODUCT_ORDER_MUST_BE_COMPLETE',
          missingProductIds: missing,
          unknownProductIds: unknown,
        });
      }
      for (const [displayOrder, id] of productIds.entries()) {
        await tx.product.update({ where: { id }, data: { displayOrder } });
      }
      await this.recordAudit(
        'product.order.update',
        { productIds },
        adminId,
        tx,
      );
      return { ok: true, productIds };
    });
  }

  async getAdminProduct(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: this.getProductInclude({
        includeInactiveVariants: true,
        includeArchivedImages: true,
      }),
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return this.addEffectiveVariantPrices(product);
  }

  async replaceProductCategories(
    productId: number,
    categoryIds: number[],
    adminId?: number,
  ) {
    if (!Number.isInteger(productId) || productId < 1) {
      throw new BadRequestException('PRODUCT_ID_MUST_BE_A_POSITIVE_INTEGER');
    }

    if (
      !Array.isArray(categoryIds) ||
      categoryIds.some((id) => !Number.isInteger(id) || id < 1)
    ) {
      throw new BadRequestException('CATEGORY_IDS_MUST_BE_POSITIVE_INTEGERS');
    }

    if (new Set(categoryIds).size !== categoryIds.length) {
      throw new BadRequestException('CATEGORY_IDS_MUST_BE_UNIQUE');
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true },
      });

      if (!product) {
        throw new NotFoundException('PRODUCT_NOT_FOUND');
      }

      const categories = categoryIds.length
        ? await tx.category.findMany({
            where: { id: { in: categoryIds } },
            select: { id: true },
          })
        : [];
      const existingCategoryIds = new Set(
        categories.map((category) => category.id),
      );
      const missingCategoryIds = categoryIds.filter(
        (categoryId) => !existingCategoryIds.has(categoryId),
      );

      if (missingCategoryIds.length) {
        throw new BadRequestException({
          code: 'CATEGORY_IDS_NOT_FOUND',
          categoryIds: missingCategoryIds,
        });
      }

      const beforeAssignments = await tx.productCategory.findMany({
        where: { productId },
        select: { categoryId: true },
        orderBy: { categoryId: 'asc' },
      });
      const beforeCategoryIds = beforeAssignments.map(
        (assignment) => assignment.categoryId,
      );

      await tx.productCategory.deleteMany({ where: { productId } });
      if (categoryIds.length) {
        await tx.productCategory.createMany({
          data: categoryIds.map((categoryId) => ({ productId, categoryId })),
          skipDuplicates: false,
        });
      }

      await this.recordAudit(
        'PRODUCT_CATEGORIES_UPDATED',
        {
          productId,
          beforeCategoryIds,
          afterCategoryIds: categoryIds,
        },
        adminId,
        tx,
      );

      const updatedProduct = await tx.product.findUnique({
        where: { id: productId },
        include: this.getProductInclude({
          includeInactiveVariants: true,
          includeArchivedImages: true,
        }),
      });

      if (!updatedProduct) {
        throw new NotFoundException('PRODUCT_NOT_FOUND');
      }

      return this.addEffectiveVariantPrices(updatedProduct);
    });
  }

  async getAllProducts(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 10, 100);
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'displayOrder';
    const order = query.order ?? 'asc';
    const normalizedSearch = normalizeSearchText(query.search).slice(0, 100);

    const orderBy: Prisma.ProductOrderByWithRelationInput[] = [
      { [sortBy]: order } as Prisma.ProductOrderByWithRelationInput,
      { id: 'asc' },
    ];

    const where: Prisma.ProductWhereInput = normalizedSearch
      ? this.buildPublicSearchWhere(normalizedSearch, query.categorySlug)
      : { isActive: true };

    if (query.categorySlug && !normalizedSearch) {
      where.categories = {
        some: {
          category: {
            slug: query.categorySlug,
            isActive: true,
          },
        },
      };
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const priceFilter: Prisma.IntFilter = {};
      if (query.minPrice !== undefined) {
        priceFilter.gte = query.minPrice;
      }
      if (query.maxPrice !== undefined) {
        priceFilter.lte = query.maxPrice;
      }
      if (Object.keys(priceFilter).length > 0) {
        where.price = priceFilter;
      }
    }

    if (query.size) {
      where.variants = {
        some: {
          size: query.size,
          isActive: true,
          stockQty: { gt: 0 },
        },
      };
    }

    if (normalizedSearch) {
      const matchedProducts = await this.prisma.product.findMany({
        where,
        include: this.getProductInclude(),
      });
      matchedProducts.sort((left, right) => {
        const scoreDifference =
          scoreProductSearch(right, normalizedSearch) -
          scoreProductSearch(left, normalizedSearch);
        if (scoreDifference) return scoreDifference;
        return left.displayOrder - right.displayOrder || left.id - right.id;
      });
      const items = matchedProducts.slice(skip, skip + limit);
      const total = matchedProducts.length;

      return {
        meta: {
          page,
          limit,
          total,
          pageCount: Math.ceil(total / limit),
          sortBy: 'relevance',
          order: 'desc',
        },
        items: items.map((product) => this.toPublicProduct(product)),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: this.getProductInclude(),
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      meta: {
        page,
        limit,
        total,
        pageCount: Math.ceil(total / limit),
        sortBy,
        order,
      },
      items: items.map((product) => this.toPublicProduct(product)),
    };
  }

  async getSearchSuggestions(query: ProductSuggestionsQueryDto) {
    const normalizedSearch = normalizeSearchText(query.search).slice(0, 100);
    if (!normalizedSearch) return { items: [] };

    const limit = Math.min(Math.max(query.limit ?? 8, 1), 8);
    const candidates = await this.prisma.product.findMany({
      where: this.buildPublicSearchWhere(normalizedSearch, query.categorySlug),
      take: Math.max(40, limit * 10),
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        collection: true,
        searchKeywords: true,
        displayOrder: true,
        price: true,
        currency: true,
        imageUrl: true,
        images: {
          where: { isActive: true },
          take: 1,
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
          select: { url: true },
        },
        categories: {
          where: { category: { isActive: true } },
          orderBy: { categoryId: 'asc' },
          select: {
            category: { select: { name: true, slug: true } },
          },
        },
      },
    });

    const searchTerms = expandSearchTokens(normalizedSearch).flat();
    return {
      items: candidates
        .sort((left, right) => {
          const scoreDifference =
            scoreProductSearch(right, normalizedSearch) -
            scoreProductSearch(left, normalizedSearch);
          if (scoreDifference) return scoreDifference;
          return left.displayOrder - right.displayOrder || left.id - right.id;
        })
        .slice(0, limit)
        .map((product) => {
          const relevantCategory =
            product.categories.find(({ category }) => {
              const categoryText = normalizeSearchText(
                `${category.name} ${category.slug}`,
              );
              return searchTerms.some((term) => categoryText.includes(term));
            })?.category ??
            product.categories[0]?.category ??
            null;

          return {
            id: product.id,
            slug: product.slug,
            name: product.name,
            price: product.price,
            currency: product.currency,
            imageUrl: product.images[0]?.url ?? product.imageUrl,
            category: relevantCategory,
          };
        }),
    };
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug, isActive: true },
      include: this.getProductInclude(),
    });

    return product ? this.toPublicProduct(product) : null;
  }

  async createProduct(
    dto: CreateProductDto,
    adminId?: number,
    idempotencyKey?: string,
  ) {
    const requestKey = this.validateIdempotencyKey(idempotencyKey);
    const requestHash = this.productCreateHash(dto);
    const currency = dto.currency ?? 'EUR';
    const images = this.prepareImages(dto);
    const slug = this.slugify(dto.slug ?? dto.name);
    if (!slug)
      throw new BadRequestException('El slug del producto no es válido.');
    const searchKeywords = normalizeSearchKeywords(dto.searchKeywords);
    const searchText = buildProductSearchText({
      ...dto,
      slug,
      searchKeywords,
    });
    const variants =
      dto.variants?.length && Array.isArray(dto.variants)
        ? dto.variants
        : this.buildDefaultVariants();

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        await this.lockProductOrder(tx);
        await tx.adminProductCreateRequest.create({
          data: { idempotencyKey: requestKey, requestHash },
        });
        const primaryImage = images.find((img) => img.isPrimary);
        const lastProduct =
          typeof tx.product.findFirst === 'function'
            ? await tx.product.findFirst({
                orderBy: [{ displayOrder: 'desc' }, { id: 'desc' }],
                select: { displayOrder: true },
              })
            : null;
        const created = await tx.product.create({
          data: {
            name: dto.name,
            slug,
            description: dto.description,
            price: dto.price,
            currency,
            isActive: dto.isActive ?? true,
            displayOrder: (lastProduct?.displayOrder ?? -1) + 1,
            collection: dto.collection,
            searchKeywords,
            searchText,
            cardImagePositionX: dto.cardImagePositionX ?? 50,
            cardImagePositionY: dto.cardImagePositionY ?? 50,
            cardImageZoom: dto.cardImageZoom ?? 1,
            imageUrl: primaryImage?.url,
            images: images.length ? { create: images } : undefined,
          },
        });

        if (variants.length) {
          await tx.productVariant.createMany({
            data: variants.map((variant) => ({
              productId: created.id,
              size: variant.size,
              sku: this.resolveVariantSku(slug, variant),
              price: variant.price ?? null,
              stockQty: variant.stockQty ?? variant.stock ?? 0, // [STOCK]
              isActive: variant.isActive ?? true,
            })),
            skipDuplicates: false,
          });
        }

        await this.recordAudit(
          'product.create',
          { productId: created.id, slug, name: dto.name },
          adminId,
          tx,
        );

        await tx.adminProductCreateRequest.update({
          where: { idempotencyKey: requestKey },
          data: { productId: created.id },
        });

        return tx.product.findUnique({
          where: { id: created.id },
          include: this.getProductInclude({ includeInactiveVariants: true }),
        });
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      return this.addEffectiveVariantPrices(product);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const target = (e.meta?.target as string[]) ?? [];
        if (target.includes('idempotencyKey')) {
          const previous =
            await this.prisma.adminProductCreateRequest.findUnique({
              where: { idempotencyKey: requestKey },
              include: {
                product: {
                  include: this.getProductInclude({
                    includeInactiveVariants: true,
                  }),
                },
              },
            });
          if (previous?.requestHash !== requestHash) {
            throw new ConflictException(
              'La clave de idempotencia ya se utilizó con otros datos.',
            );
          }
          if (!previous.product) {
            throw new ConflictException(
              'La solicitud ya fue procesada, pero el producto ya no está disponible.',
            );
          }
          return this.addEffectiveVariantPrices(previous.product);
        }
        this.handleDuplicateError(e);
      }
      throw e;
    }
  }

  async updateProduct(id: number, dto: UpdateProductDto, adminId?: number) {
    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.collection !== undefined) data.collection = dto.collection;
    if (dto.searchKeywords !== undefined) {
      data.searchKeywords = normalizeSearchKeywords(dto.searchKeywords);
    }
    if (dto.cardImagePositionX !== undefined)
      data.cardImagePositionX = dto.cardImagePositionX;
    if (dto.cardImagePositionY !== undefined)
      data.cardImagePositionY = dto.cardImagePositionY;
    if (dto.cardImageZoom !== undefined) data.cardImageZoom = dto.cardImageZoom;

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.product.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Product not found');
        }

        if (
          dto.expectedUpdatedAt &&
          existing.updatedAt.getTime() !==
            new Date(dto.expectedUpdatedAt).getTime()
        ) {
          throw new ConflictException(
            'La galerÃ­a cambiÃ³ en otra sesiÃ³n. Recarga el producto antes de guardar.',
          );
        }
        if (dto.expectedUpdatedAt) {
          const claimed = await tx.product.updateMany({
            where: { id, updatedAt: existing.updatedAt },
            data: { updatedAt: new Date() },
          });
          if (claimed.count !== 1) {
            throw new ConflictException(
              'La galerÃ­a cambiÃ³ en otra sesiÃ³n. Recarga el producto antes de guardar.',
            );
          }
        }

        if (dto.slug !== undefined) {
          const baseSlug = dto.slug || this.slugify(dto.name ?? existing.name);
          data.slug = await this.ensureUniqueSlug(baseSlug, tx, id);
        }

        const nextSearchKeywords =
          dto.searchKeywords !== undefined
            ? normalizeSearchKeywords(dto.searchKeywords)
            : existing.searchKeywords;
        data.searchText = buildProductSearchText({
          name: dto.name ?? existing.name,
          slug: typeof data.slug === 'string' ? data.slug : existing.slug,
          description: dto.description ?? existing.description,
          collection: dto.collection ?? existing.collection,
          searchKeywords: nextSearchKeywords,
        });

        if (Object.keys(data).length > 0) {
          await tx.product.update({
            where: { id },
            data,
          });
        }

        const replaceImages =
          (Array.isArray(dto.imageUrls) && dto.imageUrls.length > 0) ||
          (Array.isArray(dto.images) && dto.images.length > 0);

        if (replaceImages) {
          await tx.productImage.deleteMany({ where: { productId: id } });
          const newImages = this.prepareImages(
            dto as unknown as {
              images?: CreateProductImageDto[];
              imageUrls?: string[];
            },
          );
          if (newImages.length) {
            await tx.productImage.createMany({
              data: newImages.map((img) => ({
                productId: id,
                url: img.url,
                alt: 'alt' in img ? (img.alt ?? '') : '',
                sortOrder: img.sortOrder ?? 0,
                isPrimary: img.isPrimary ?? false,
              })),
            });
            const primary =
              newImages.find((img) => img.isPrimary) ?? newImages[0];
            await tx.product.update({
              where: { id },
              data: { imageUrl: primary?.url },
            });
          } else {
            await tx.product.update({
              where: { id },
              data: { imageUrl: null },
            });
          }
        }

        if (dto.imagesToCreate?.length && !replaceImages) {
          await tx.productImage.createMany({
            data: dto.imagesToCreate.map((img) => ({
              productId: id,
              url: img.url,
              alt: 'alt' in img ? (img.alt ?? '') : '',
              sortOrder: img.sortOrder ?? 0,
              isPrimary: img.isPrimary ?? false,
            })),
          });
        }

        if (dto.imagesToUpdate?.length && !replaceImages) {
          const imageIds = [
            ...new Set(dto.imagesToUpdate.map((image) => image.id)),
          ];
          const ownedImages = await tx.productImage.findMany({
            where: { id: { in: imageIds }, productId: id },
            select: { id: true },
          });
          if (ownedImages.length !== imageIds.length) {
            throw new NotFoundException('Image not found for product');
          }

          for (const img of dto.imagesToUpdate) {
            await tx.productImage.update({
              where: { id: img.id },
              data: {
                url: img.url,
                alt: img.alt,
                sortOrder: img.sortOrder,
                isPrimary: img.isPrimary,
              },
            });
          }
        }

        if (dto.imagesToDeleteIds?.length && !replaceImages) {
          const imageIds = [...new Set(dto.imagesToDeleteIds)];
          const ownedImages = await tx.productImage.findMany({
            where: { id: { in: imageIds }, productId: id },
            select: { id: true },
          });
          if (ownedImages.length !== imageIds.length) {
            throw new NotFoundException('Image not found for product');
          }

          await tx.productImage.deleteMany({
            where: { id: { in: imageIds }, productId: id },
          });
        }

        if (dto.galleryImages) {
          this.validateGallery(dto.galleryImages);
          const persistedImages = await tx.productImage.findMany({
            where: { productId: id },
          });
          const persistedIds = new Set(
            persistedImages.map((image) => image.id),
          );
          const submittedIds = new Set(
            dto.galleryImages.flatMap((image) => (image.id ? [image.id] : [])),
          );
          if (
            submittedIds.size !== persistedIds.size ||
            [...submittedIds].some((imageId) => !persistedIds.has(imageId))
          ) {
            throw new ConflictException(
              'La galerÃ­a cambiÃ³ en otra sesiÃ³n. Recarga el producto antes de guardar.',
            );
          }
          const newImages = dto.galleryImages.filter((image) => !image.id);
          if (
            newImages.some(
              (image) => !this.storage?.isManagedProductImage(image.url),
            )
          ) {
            throw new BadRequestException(
              'Una imagen nueva no pertenece al almacenamiento de productos.',
            );
          }

          await tx.productImage.updateMany({
            where: { productId: id },
            data: { isPrimary: false },
          });
          const galleryAuditActions: Array<{
            action: string;
            imageId?: number;
          }> = [];
          for (const image of dto.galleryImages) {
            const previous = image.id
              ? persistedImages.find((candidate) => candidate.id === image.id)
              : undefined;
            if (!previous) {
              galleryAuditActions.push({ action: 'product.gallery.upload' });
            } else {
              if (!previous.isActive && image.isActive) {
                galleryAuditActions.push({
                  action: 'product.gallery.restore',
                  imageId: image.id,
                });
              }
              if (previous.isActive && !image.isActive) {
                galleryAuditActions.push({
                  action: 'product.gallery.archive',
                  imageId: image.id,
                });
              }
              if (previous.sortOrder !== image.sortOrder) {
                galleryAuditActions.push({
                  action: 'product.gallery.reorder',
                  imageId: image.id,
                });
              }
              if (!previous.isPrimary && image.isPrimary) {
                galleryAuditActions.push({
                  action: 'product.gallery.primary',
                  imageId: image.id,
                });
              }
            }
            const imageData = {
              ...this.galleryImageData(image),
              archivedAt: image.isActive
                ? null
                : (previous?.archivedAt ?? new Date()),
            };
            if (image.id) {
              await tx.productImage.update({
                where: { id: image.id },
                data: imageData,
              });
            } else {
              await tx.productImage.create({
                data: { productId: id, ...imageData },
              });
            }
          }
          const primary = dto.galleryImages.find((image) => image.isPrimary);
          await tx.product.update({
            where: { id },
            data: { imageUrl: primary?.url ?? null },
          });
          for (const event of galleryAuditActions) {
            await tx.auditLog.create({
              data: {
                actorId: adminId ?? null,
                action: event.action,
                metadata: { productId: id, imageId: event.imageId ?? null },
              },
            });
          }
          await tx.auditLog.create({
            data: {
              actorId: adminId ?? null,
              action: 'product.gallery.update',
              metadata: {
                productId: id,
                activeImageCount: dto.galleryImages.filter(
                  (image) => image.isActive,
                ).length,
                archivedImageCount: dto.galleryImages.filter(
                  (image) => !image.isActive,
                ).length,
              },
            },
          });
        }

        if (dto.variantsToCreate?.length) {
          const productSlug =
            typeof data.slug === 'string' ? data.slug : existing.slug;
          await tx.productVariant.createMany({
            data: dto.variantsToCreate.map((variant) => ({
              productId: id,
              size: variant.size,
              sku: this.resolveVariantSku(productSlug, variant),
              price: variant.price ?? null,
              stockQty: variant.stockQty ?? variant.stock ?? 0, // [STOCK]
              isActive: variant.isActive ?? true,
            })),
            skipDuplicates: false,
          });
        }

        if (dto.variantsToUpdate?.length) {
          for (const variant of dto.variantsToUpdate) {
            const { id: variantId, ...variantData } = variant;

            const variantExists = await tx.productVariant.findFirst({
              where: { id: variantId, productId: id },
              select: { id: true },
            });

            if (!variantExists) {
              throw new NotFoundException('Variant not found');
            }

            await tx.productVariant.update({
              where: { id: variantId },
              data: {
                ...(variantData.size !== undefined
                  ? { size: variantData.size }
                  : {}),
                ...(variantData.sku !== undefined
                  ? { sku: variantData.sku }
                  : {}),
                ...(variantData.price !== undefined
                  ? { price: variantData.price }
                  : {}),
                ...(variantData.stockQty !== undefined ||
                variantData.stock !== undefined
                  ? {
                      stockQty: variantData.stockQty ?? variantData.stock ?? 0,
                    }
                  : {}),
                ...(variantData.isActive !== undefined
                  ? { isActive: variantData.isActive }
                  : {}),
              },
            });
          }
        }

        if (dto.variantIdsToDelete?.length) {
          const variants = await tx.productVariant.findMany({
            where: { id: { in: dto.variantIdsToDelete }, productId: id },
            select: { id: true },
          });

          const idsToRemove = variants.map((variant) => variant.id);

          if (idsToRemove.length) {
            await tx.stockMovement.deleteMany({
              where: { variantId: { in: idsToRemove } },
            });

            await tx.productVariant.deleteMany({
              where: { id: { in: idsToRemove } },
            });
          }
        }

        const images = await tx.productImage.findMany({
          where: { productId: id, isActive: true },
          orderBy: this.imageOrderBy,
        });

        if (images.length > 0 && !images.some((image) => image.isPrimary)) {
          await tx.productImage.update({
            where: { id: images[0].id },
            data: { isPrimary: true },
          });
        }

        if (!replaceImages && !dto.galleryImages) {
          const primary = images.find((img) => img.isPrimary) ?? images[0];
          await tx.product.update({
            where: { id },
            data: { imageUrl: primary?.url ?? null },
          });
        }

        const updated = await tx.product.findUnique({
          where: { id },
          include: this.getProductInclude({
            includeInactiveVariants: true,
            includeArchivedImages: true,
          }),
        });

        if (!updated) {
          throw new NotFoundException('Product not found');
        }

        const serializedPayload: unknown = JSON.parse(JSON.stringify(dto));
        await this.recordAudit(
          'product.update',
          {
            productId: updated.id,
            payload: serializedPayload as Prisma.InputJsonValue,
          },
          adminId,
          tx,
        );

        return updated;
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      return this.addEffectiveVariantPrices(product);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          this.handleDuplicateError(e);
        }
        if (e.code === 'P2025') {
          throw new NotFoundException('Product not found');
        }
      }
      throw e;
    }
  }

  async deleteProduct(id: number, adminId?: number) {
    if (!Number.isInteger(id) || id < 1) {
      throw new BadRequestException('ID de producto no válido');
    }
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.product.findUnique({
          where: { id },
          include: { images: { select: { url: true } } },
        });
        if (!existing) {
          throw new NotFoundException('Producto no encontrado');
        }

        const [orderItems, checkoutItems, stockReservations, stockMovements] =
          await Promise.all([
            tx.orderItem.count({ where: { productId: id } }),
            tx.checkoutSnapshotItem.count({ where: { productId: id } }),
            tx.checkoutStockReservation.count({
              where: { variant: { productId: id } },
            }),
            tx.stockMovement.count({ where: { variant: { productId: id } } }),
          ]);
        if (
          orderItems ||
          checkoutItems ||
          stockReservations ||
          stockMovements
        ) {
          throw new ConflictException(
            'No se puede eliminar este producto porque está vinculado a pedidos, checkout o historial de inventario. Puedes desactivarlo para conservar la información histórica.',
          );
        }

        await tx.galleryAssetProduct.deleteMany({ where: { productId: id } });
        await tx.favorite.deleteMany({ where: { productId: id } });
        await tx.cartItem.deleteMany({ where: { variant: { productId: id } } });
        await tx.productCategory.deleteMany({ where: { productId: id } });
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.productVariant.deleteMany({ where: { productId: id } });
        await tx.product.delete({ where: { id } });

        await this.recordAudit(
          'product.delete',
          { productId: id, name: existing.name, slug: existing.slug },
          adminId,
          tx,
        );

        return {
          ok: true,
          productId: id,
          imageUrls: [
            ...new Set([
              ...existing.images.map((image) => image.url),
              ...(existing.imageUrl ? [existing.imageUrl] : []),
            ]),
          ],
        };
      });

      const removableUrls: string[] = [];
      for (const url of result.imageUrls) {
        const [products, images, galleries, websiteMedia, emailAssets] =
          await Promise.all([
            this.prisma.product.count({ where: { imageUrl: url } }),
            this.prisma.productImage.count({ where: { url } }),
            this.prisma.galleryAsset.count({ where: { publicUrl: url } }),
            this.prisma.websiteMediaAsset.count({ where: { publicUrl: url } }),
            this.prisma.emailAsset.count({ where: { url } }),
          ]);
        if (!(products + images + galleries + websiteMedia + emailAssets)) {
          removableUrls.push(url);
        }
      }
      if (removableUrls.length && this.storage) {
        try {
          await this.storage.deleteProductImages(removableUrls);
        } catch (error) {
          this.logger.error(
            `Producto ${id} eliminado, pero falló la limpieza de ${removableUrls.length} archivo(s)`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
      return { ok: true, productId: result.productId };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Producto no encontrado');
      }
      throw e;
    }
  }

  async deleteImage(productId: number, imageId: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const image = await tx.productImage.findFirst({
          where: { id: imageId, productId },
          select: { id: true },
        });
        if (!image) throw new NotFoundException('Image not found for product');

        await tx.productImage.delete({ where: { id: imageId } });
        const images = await tx.productImage.findMany({
          where: { productId },
          orderBy: this.imageOrderBy,
        });
        const primary =
          images.find((candidate) => candidate.isPrimary) ?? images[0];
        if (primary && !primary.isPrimary) {
          await tx.productImage.update({
            where: { id: primary.id },
            data: { isPrimary: true },
          });
        }
        await tx.product.update({
          where: { id: productId },
          data: { imageUrl: primary?.url ?? null },
        });

        return { ok: true };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Image not found');
      }
      throw e;
    }
  }

  async permanentlyDeleteArchivedImage(
    productId: number,
    imageId: number,
    expectedUpdatedAt: string,
    adminId?: number,
  ) {
    if (!this.storage) {
      throw new ConflictException(
        'El almacenamiento de productos no estÃ¡ disponible.',
      );
    }

    const removed = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, updatedAt: true },
      });
      if (!product) throw new NotFoundException('Producto no encontrado');
      if (
        product.updatedAt.getTime() !== new Date(expectedUpdatedAt).getTime()
      ) {
        throw new ConflictException(
          'La galerÃ­a cambiÃ³ en otra sesiÃ³n. Recarga el producto antes de continuar.',
        );
      }

      const image = await tx.productImage.findFirst({
        where: { id: imageId, productId },
      });
      if (!image) throw new NotFoundException('Imagen no encontrada');
      if (image.isActive || image.isPrimary) {
        throw new ConflictException(
          'Solo se pueden eliminar definitivamente imÃ¡genes archivadas.',
        );
      }
      if (!this.storage?.isManagedProductImage(image.url)) {
        throw new ConflictException(
          'El archivo no pertenece al almacenamiento administrado y no se puede borrar con seguridad.',
        );
      }

      const [products, productImages, galleries, websiteMedia, emailAssets] =
        await Promise.all([
          tx.product.count({ where: { imageUrl: image.url } }),
          tx.productImage.count({
            where: { url: image.url, id: { not: image.id } },
          }),
          tx.galleryAsset.count({ where: { publicUrl: image.url } }),
          tx.websiteMediaAsset.count({ where: { publicUrl: image.url } }),
          tx.emailAsset.count({ where: { url: image.url } }),
        ]);
      if (
        products + productImages + galleries + websiteMedia + emailAssets >
        0
      ) {
        throw new ConflictException(
          'La imagen sigue referenciada por otro registro y no se puede eliminar definitivamente.',
        );
      }

      const touched = await tx.product.updateMany({
        where: { id: productId, updatedAt: product.updatedAt },
        data: { updatedAt: new Date() },
      });
      if (touched.count !== 1) {
        throw new ConflictException(
          'La galerÃ­a cambiÃ³ en otra sesiÃ³n. Recarga el producto antes de continuar.',
        );
      }
      await tx.productImage.update({
        where: { id: image.id },
        data: { deletionState: 'PENDING' },
      });
      await tx.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action: 'product.gallery.image.delete.requested',
          metadata: { productId, imageId },
        },
      });
      return image;
    });

    try {
      await this.storage.deleteProductImages([removed.url]);
    } catch (error) {
      await this.prisma.productImage.updateMany({
        where: {
          id: imageId,
          productId,
          isActive: false,
          deletionState: 'PENDING',
        },
        data: { deletionState: null },
      });
      this.logger.error(
        `No se pudo eliminar del almacenamiento la imagen archivada ${imageId} del producto ${productId}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ConflictException(
        'No se pudo eliminar el archivo. La imagen se ha conservado en el historial para poder reintentarlo.',
      );
    }

    const finalized = await this.prisma.productImage.deleteMany({
      where: {
        id: imageId,
        productId,
        isActive: false,
        deletionState: 'PENDING',
      },
    });
    if (finalized.count !== 1) {
      throw new ConflictException(
        'El archivo se eliminÃ³, pero queda una limpieza de base de datos pendiente. Recarga y vuelve a intentarlo.',
      );
    }

    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { updatedAt: true },
    });
    return { ok: true, productId, imageId, updatedAt: product?.updatedAt };
  }

  async createVariants(
    productId: number,
    dto: CreateVariantDto | CreateVariantDto[],
  ) {
    const variants = Array.isArray(dto) ? dto : [dto];

    let existingProduct: { slug: string };
    try {
      existingProduct = await this.prisma.product.findUniqueOrThrow({
        where: { id: productId },
        select: { slug: true },
      });
    } catch {
      throw new NotFoundException('Product not found');
    }

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (variants.length) {
          await tx.productVariant.createMany({
            data: variants.map((variant) => ({
              productId,
              size: variant.size,
              sku: this.resolveVariantSku(existingProduct.slug, variant),
              price: variant.price ?? null,
              stockQty: variant.stockQty ?? variant.stock ?? 0, // [STOCK]
              isActive: variant.isActive ?? true,
            })),
            skipDuplicates: false,
          });
        }

        return tx.product.findUnique({
          where: { id: productId },
          include: this.getProductInclude({ includeInactiveVariants: true }),
        });
      });

      if (!product) {
        throw new NotFoundException('Product not found');
      }

      return this.addEffectiveVariantPrices(product);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        this.handleDuplicateError(e);
      }
      throw e;
    }
  }

  async updateVariant(
    productId: number,
    variantId: number,
    dto: UpdateVariantDto,
  ) {
    const existing = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
    });

    if (!existing) {
      throw new NotFoundException('Variant not found');
    }

    try {
      const updated = await this.prisma.productVariant.update({
        where: { id: variantId },
        data: {
          ...(dto.size !== undefined ? { size: dto.size } : {}),
          ...(dto.sku !== undefined ? { sku: dto.sku } : {}),
          ...(dto.price !== undefined ? { price: dto.price } : {}),
          ...(dto.stockQty !== undefined || dto.stock !== undefined
            ? { stockQty: dto.stockQty ?? dto.stock ?? 0 }
            : {}), // [STOCK]
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        include: { product: { select: { price: true } } },
      });

      return this.buildVariantResponse(updated);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        this.handleDuplicateError(e);
      }
      throw e;
    }
  }

  async deleteVariant(productId: number, variantId: number) {
    const existing = await this.prisma.productVariant.findFirst({
      where: { id: variantId, productId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Variant not found');
    }

    await this.prisma.$transaction([
      this.prisma.stockMovement.deleteMany({ where: { variantId } }),
      this.prisma.productVariant.delete({ where: { id: variantId } }),
    ]);

    return { ok: true };
  }

  async adjustVariantStock(
    productId: number,
    variantId: number,
    dto: AdjustStockDto,
    performedById?: number,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, productId },
      });

      if (!variant) {
        throw new NotFoundException('Variant not found');
      }

      const stockGuard: Prisma.IntFilter =
        dto.delta < 0
          ? { gte: -dto.delta }
          : dto.delta > 0
            ? { lte: 2_147_483_647 - dto.delta }
            : {};
      const changed = await tx.productVariant.updateMany({
        where: { id: variantId, productId, stockQty: stockGuard },
        data: { stockQty: { increment: dto.delta } }, // [STOCK]
      });
      if (changed.count !== 1) {
        throw new ConflictException('STOCK_ADJUSTMENT_OUT_OF_RANGE');
      }

      const updated = await tx.productVariant.findUnique({
        where: { id: variantId },
        include: { product: { select: { price: true } } },
      });
      if (!updated) throw new NotFoundException('Variant not found');

      await tx.stockMovement.create({
        data: {
          variantId,
          delta: dto.delta,
          reason: dto.reason ?? 'manual', // [STOCK]
          userId: performedById,
        },
      });

      return this.buildVariantResponse(updated);
    });
  }
}
