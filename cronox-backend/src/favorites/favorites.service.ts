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
    const existing = await this.prisma.favorite.findUnique({
      where: { userId_productId: { userId, productId: product.id } },
      select: { id: true },
    });

    await this.prisma.favorite.upsert({
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
  }

  async toggle(userId: number, dto: AddFavoriteDto) {
    const product = await this.findProduct(dto);
    const existing = await this.prisma.favorite.findUnique({
      where: { userId_productId: { userId, productId: product.id } },
    });

    if (existing) {
      await this.prisma.favorite.delete({
        where: { userId_productId: { userId, productId: product.id } },
      });
      return {
        productId: product.id,
        product: this.toProductResponse(product),
        isFavorite: false,
      };
    }

    await this.prisma.favorite.create({
      data: { userId, productId: product.id },
    });
    return {
      productId: product.id,
      product: this.toProductResponse(product),
      isFavorite: true,
    };
  }

  async remove(userId: number, productIdOrSlug: string) {
    if (!productIdOrSlug) {
      throw new BadRequestException('Product identifier is required');
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

    const removed = await this.prisma.favorite.deleteMany({
      where: { userId, productId },
    });
    return removed.count > 0 ? productId : null;
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
