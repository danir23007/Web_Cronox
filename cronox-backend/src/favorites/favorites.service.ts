import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AddFavoriteDto } from './dto/add-favorite.dto';

type FavoriteProduct = Prisma.ProductGetPayload<{
  include: { images: true };
}>;

@Injectable()
export class FavoritesService {
  private readonly imageOrderBy: Prisma.ProductImageOrderByWithRelationInput[] = [
    { sortOrder: 'asc' },
    { id: 'asc' },
  ];

  constructor(private readonly prisma: PrismaService) {}

  async list(userId: number) {
    const favorites = await this.prisma.favorite.findMany({
      where: { userId },
      include: {
        product: {
          include: { images: { orderBy: this.imageOrderBy } },
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

  async add(userId: number, dto: AddFavoriteDto) {
    const product = await this.findProduct(dto);

    await this.prisma.favorite.upsert({
      where: { userId_productId: { userId, productId: product.id } },
      update: {},
      create: { userId, productId: product.id },
    });

    return {
      productId: product.id,
      product: this.toProductResponse(product),
      isFavorite: true,
    };
  }

  async toggle(userId: number, dto: AddFavoriteDto) {
    const product = await this.findProduct(dto);
    const existing = await this.prisma.favorite.findUnique({
      where: { userId_productId: { userId, productId: product.id } },
    });

    if (existing) {
      await this.prisma.favorite.delete({ where: { userId_productId: { userId, productId: product.id } } });
      return { productId: product.id, product: this.toProductResponse(product), isFavorite: false };
    }

    await this.prisma.favorite.create({ data: { userId, productId: product.id } });
    return { productId: product.id, product: this.toProductResponse(product), isFavorite: true };
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
        return;
      }

      productId = product.id;
    }

    await this.prisma.favorite.deleteMany({ where: { userId, productId } });
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

    const product = await this.prisma.product.findUnique({
      where,
      include: { images: { orderBy: this.imageOrderBy } },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }

  private toProductResponse(product: FavoriteProduct) {
    const primaryImage = product.images.find((image) => image.isPrimary) ?? product.images[0];

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      price: product.price,
      currency: product.currency,
      imageUrl: product.imageUrl ?? primaryImage?.url ?? null,
    };
  }
}
