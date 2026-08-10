import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, VariantSize } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
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

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

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

  private buildDefaultVariants(slug: string): CreateVariantDto[] {
    return this.defaultSizes.map((size, index) => ({
      size,
      sku: `${slug || 'producto'}-${size}-${Date.now().toString(36)}${index}`,
      stockQty: 0,
      isActive: true,
    }));
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
  }): Prisma.ProductInclude {
    const variantArgs: Prisma.ProductVariantFindManyArgs = {
      orderBy: this.variantOrderBy,
    };

    if (!options?.includeInactiveVariants) {
      variantArgs.where = { isActive: true };
    }

    return {
      images: { orderBy: this.imageOrderBy },
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
      collection: true,
      searchKeywords: true,
      createdAt: true,
      updatedAt: true,
      images: {
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

  async getAdminProduct(id: number) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: this.getProductInclude({ includeInactiveVariants: true }),
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
        include: this.getProductInclude({ includeInactiveVariants: true }),
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
    const sortBy = query.sortBy ?? 'id';
    const order = query.order ?? 'asc';
    const normalizedSearch = normalizeSearchText(query.search).slice(0, 100);

    const orderBy = {
      [sortBy]: order,
    } as Prisma.ProductOrderByWithRelationInput;

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
        return right.createdAt.getTime() - left.createdAt.getTime();
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
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        collection: true,
        searchKeywords: true,
        price: true,
        currency: true,
        imageUrl: true,
        images: {
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
          return left.name.localeCompare(right.name, 'es');
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

  async createProduct(dto: CreateProductDto, adminId?: number) {
    const currency = dto.currency ?? 'EUR';
    const images = this.prepareImages(dto);
    const slug = await this.ensureUniqueSlug(
      dto.slug ?? this.slugify(dto.name),
    );
    const searchKeywords = normalizeSearchKeywords(dto.searchKeywords);
    const searchText = buildProductSearchText({
      ...dto,
      slug,
      searchKeywords,
    });
    const variants =
      dto.variants?.length && Array.isArray(dto.variants)
        ? dto.variants
        : this.buildDefaultVariants(slug);

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const primaryImage = images.find((img) => img.isPrimary);
        const created = await tx.product.create({
          data: {
            name: dto.name,
            slug,
            description: dto.description,
            price: dto.price,
            currency,
            isActive: dto.isActive ?? true,
            collection: dto.collection,
            searchKeywords,
            searchText,
            imageUrl: primaryImage?.url,
            images: images.length ? { create: images } : undefined,
          },
        });

        if (variants.length) {
          await tx.productVariant.createMany({
            data: variants.map((variant, index) => ({
              productId: created.id,
              size: variant.size,
              sku:
                variant.sku ||
                `${slug}-${variant.size}-${Math.random().toString(36).slice(2, 6)}${index}`,
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

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.product.findUnique({ where: { id } });

        if (!existing) {
          throw new NotFoundException('Product not found');
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

        if (dto.variantsToCreate?.length) {
          await tx.productVariant.createMany({
            data: dto.variantsToCreate.map((variant, index) => ({
              productId: id,
              size: variant.size,
              sku:
                variant.sku ||
                `${existing.slug}-${variant.size}-${Math.random().toString(36).slice(2, 6)}${index}`,
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
          where: { productId: id },
          orderBy: this.imageOrderBy,
        });

        if (images.length > 0 && !images.some((image) => image.isPrimary)) {
          await tx.productImage.update({
            where: { id: images[0].id },
            data: { isPrimary: true },
          });
        }

        if (!replaceImages) {
          const primary = images.find((img) => img.isPrimary) ?? images[0];
          await tx.product.update({
            where: { id },
            data: { imageUrl: primary?.url ?? null },
          });
        }

        const updated = await tx.product.findUnique({
          where: { id },
          include: this.getProductInclude({ includeInactiveVariants: true }),
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
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.product.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundException('Product not found');
        }

        await tx.product.update({
          where: { id },
          data: { isActive: false },
        });

        await tx.productVariant.updateMany({
          where: { productId: id },
          data: { isActive: false },
        });

        await this.recordAudit(
          'product.disable',
          { productId: id },
          adminId,
          tx,
        );

        return { ok: true };
      });

      return result;
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2025'
      ) {
        throw new NotFoundException('Product not found');
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

  async createVariants(
    productId: number,
    dto: CreateVariantDto | CreateVariantDto[],
  ) {
    const variants = Array.isArray(dto) ? dto : [dto];

    try {
      await this.prisma.product.findUniqueOrThrow({ where: { id: productId } });
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
              sku: variant.sku,
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

      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data: { stockQty: { increment: dto.delta } }, // [STOCK]
        include: { product: { select: { price: true } } },
      });

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
