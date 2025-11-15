import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateVariantDto } from './dto/create-variant.dto';
import { AdjustStockDto, UpdateVariantDto } from './dto/update-variant.dto';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly imageOrderBy: Prisma.ProductImageOrderByWithRelationInput[] =
    [{ sortOrder: 'asc' }, { id: 'asc' }];

  private readonly variantOrderBy: Prisma.ProductVariantOrderByWithRelationInput[] =
    [{ id: 'asc' }];

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

  async getAllProducts(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'id';
    const order = query.order ?? 'asc';

    const orderBy = {
      [sortBy]: order,
    } as Prisma.ProductOrderByWithRelationInput;

    const where: Prisma.ProductWhereInput = {};

    if (query.categorySlug) {
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
      items: items.map((product) => this.addEffectiveVariantPrices(product)),
    };
  }

  async getBySlug(slug: string) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: this.getProductInclude(),
    });

    return this.addEffectiveVariantPrices(product);
  }

  async createProduct(dto: CreateProductDto) {
    const currency = dto.currency ?? 'EUR';
    let images = dto.images ?? [];

    if (
      images.length > 0 &&
      !images.some((image) => image.isPrimary === true)
    ) {
      images = images.map((image, index) => ({
        ...image,
        isPrimary: index === 0,
      }));
    }

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        const created = await tx.product.create({
          data: {
            name: dto.name,
            slug: dto.slug,
            price: dto.price,
            currency,
            images: { create: images },
          },
        });

        if (dto.variants?.length) {
          await tx.productVariant.createMany({
            data: dto.variants.map((variant) => ({
              productId: created.id,
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

  async updateProduct(id: number, dto: UpdateProductDto) {
    const data: Prisma.ProductUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.price !== undefined) data.price = dto.price;
    if (dto.currency !== undefined) data.currency = dto.currency;

    try {
      const product = await this.prisma.$transaction(async (tx) => {
        if (Object.keys(data).length > 0) {
          await tx.product.update({
            where: { id },
            data,
          });
        } else {
          const exists = await tx.product.findUnique({ where: { id } });
          if (!exists) {
            throw new NotFoundException('Product not found');
          }
        }

        if (dto.imagesToCreate?.length) {
          await tx.productImage.createMany({
            data: dto.imagesToCreate.map((img) => ({
              productId: id,
              url: img.url,
              alt: img.alt ?? '',
              sortOrder: img.sortOrder ?? 0,
              isPrimary: img.isPrimary ?? false,
            })),
          });
        }

        if (dto.imagesToUpdate?.length) {
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

        if (dto.imagesToDeleteIds?.length) {
          await tx.productImage.deleteMany({
            where: { id: { in: dto.imagesToDeleteIds } },
          });
        }

        if (dto.variantsToCreate?.length) {
          await tx.productVariant.createMany({
            data: dto.variantsToCreate.map((variant) => ({
              productId: id,
              size: variant.size,
              sku: variant.sku,
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

            const existing = await tx.productVariant.findFirst({
              where: { id: variantId, productId: id },
              select: { id: true },
            });

            if (!existing) {
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
                ...(variantData.stockQty !== undefined || variantData.stock !== undefined
                  ? {
                      stockQty:
                        variantData.stockQty ?? variantData.stock ?? 0,
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

        return tx.product.findUnique({
          where: { id },
          include: this.getProductInclude({ includeInactiveVariants: true }),
        });
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

  async deleteProduct(id: number) {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.stockMovement.deleteMany({
          where: { variant: { productId: id } },
        });

        await tx.productVariant.deleteMany({ where: { productId: id } });
        await tx.productImage.deleteMany({ where: { productId: id } });
        await tx.product.delete({ where: { id } });
      });
      return { ok: true };
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

  async deleteImage(imageId: number) {
    try {
      const deleted = await this.prisma.productImage.delete({
        where: { id: imageId },
      });
      const images = await this.prisma.productImage.findMany({
        where: { productId: deleted.productId },
        orderBy: this.imageOrderBy,
      });

      if (images.length > 0 && !images.some((image) => image.isPrimary)) {
        await this.prisma.productImage.update({
          where: { id: images[0].id },
          data: { isPrimary: true },
        });
      }

      return { ok: true };
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
