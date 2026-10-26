import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { sizeOrder, variantSizeLabel } from '../products/product-size-system';
import { AddFavoriteDto } from './dto/add-favorite.dto';

type FavoriteProduct = Prisma.ProductGetPayload<{
  include: { images: true; variants: true };
}>;

@Injectable()
export class FavoritesService {
  private readonly imageOrderBy: Prisma.ProductImageOrderByWithRelationInput[] =
    [{ sortOrder: 'asc' }, { id: 'asc' }];

  constructor(private readonly prisma: PrismaService) {}

  private mutate<T>(
    userId: number,
    productId: number,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'favorite:' + userId + ':' + productId}, 0))`;
        return operation(tx);
      },
      { maxWait: 10_000, timeout: 10_000 },
    );
  }

  async list(userId: number) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId, product: { isActive: true } },
      include: {
        product: {
          include: {
            images: { where: { isActive: true }, orderBy: this.imageOrderBy },
            variants: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((favorite) => ({
      id: favorite.id,
      productId: favorite.productId,
      createdAt: favorite.createdAt,
      product: this.toProductResponse(favorite.product),
    }));
  }

  async listProducts(userId: number) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId, product: { isActive: true } },
      include: {
        product: {
          include: {
            images: { where: { isActive: true }, orderBy: this.imageOrderBy },
            variants: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return favorites.map((favorite) =>
      this.toProductResponse(favorite.product),
    );
  }

  async add(userId: number, dto: AddFavoriteDto) {
    const product = await this.findProduct(dto);
    return this.mutate(userId, product.id, async (tx) => {
      const existing = await tx.favorite.findUnique({
        where: { userId_productId: { userId, productId: product.id } },
        select: { id: true },
      });

      await tx.favorite.upsert({
        where: { userId_productId: { userId, productId: product.id } },
        update: {},
        create: { userId, productId: product.id },
      });

      return {
        productId: product.id,
        product: this.toProductResponse(product),
        isFavorite: true,
        created: !existing,
      };
    });
  }

  async toggle(userId: number, dto: AddFavoriteDto) {
    const product = await this.findProduct(dto);
    return this.mutate(userId, product.id, async (tx) => {
      const existing = await tx.favorite.findUnique({
        where: { userId_productId: { userId, productId: product.id } },
      });

      if (existing) {
        await tx.favorite.delete({
          where: { userId_productId: { userId, productId: product.id } },
        });
        return {
          productId: product.id,
          product: this.toProductResponse(product),
          isFavorite: false,
        };
      }

      await tx.favorite.create({
        data: { userId, productId: product.id },
      });
      return {
        productId: product.id,
        product: this.toProductResponse(product),
        isFavorite: true,
      };
    });
  }

  async remove(userId: number, productIdOrSlug: string) {
    if (!productIdOrSlug) {
      throw new BadRequestException('Falta el identificador del producto.');
    }

    let productId = Number(productIdOrSlug);

    if (!Number.isFinite(productId)) {
      const product = await this.prisma.product.findUnique({
        where: { slug: productIdOrSlug },
        select: { id: true },
      });

      if (!product) {
        return null;
      }

      productId = product.id;
    }

    return this.mutate(userId, productId, async (tx) => {
      const removed = await tx.favorite.deleteMany({
        where: { userId, productId },
      });
      return removed.count > 0 ? productId : null;
    });
  }

  private async findProduct(dto: AddFavoriteDto): Promise<FavoriteProduct> {
    if (!dto.productId && !dto.slug) {
      throw new BadRequestException('Debes enviar productId o slug');
    }

    const where: Prisma.ProductWhereUniqueInput | null = dto.productId
      ? { id: dto.productId }
      : dto.slug
        ? { slug: dto.slug }
        : null;

    if (!where) {
      throw new BadRequestException('Debes enviar productId o slug');
    }

    const product = await this.prisma.product.findFirst({
      where: { ...where, isActive: true },
      include: {
        images: { where: { isActive: true }, orderBy: this.imageOrderBy },
        variants: true,
      },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }

  private toProductResponse(product: FavoriteProduct) {
    const primaryImage =
      product.images.find((image) => image.isPrimary) ?? product.images[0];
    const imageRecords = product.images.map((image) => ({ ...image }));

    return {
      id: product.id,
      backendId: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      priceInCents: product.price,
      currency: product.currency,
      sizeSystem: product.sizeSystem,
      lastUnitsThreshold: product.lastUnitsThreshold ?? null,
      variants: product.variants
        .map(({ id, size, sku, price, stockQty, isActive }) => ({
          id,
          size,
          sizeLabel: variantSizeLabel(size),
          sku,
          price,
          stockQty,
          isActive,
        }))
        .sort((left, right) => sizeOrder(left.size) - sizeOrder(right.size)),
      imageUrl: primaryImage?.url ?? product.imageUrl ?? null,
      images: product.images.map((image) => image.url),
      imageRecords,
    };
  }
}
