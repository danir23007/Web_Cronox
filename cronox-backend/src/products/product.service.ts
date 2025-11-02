import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { QueryProductsDto } from './dto/query-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllProducts(query: QueryProductsDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy ?? 'id';
    const order = query.order ?? 'asc';

    const orderBy = { [sortBy]: order } as Prisma.ProductOrderByWithRelationInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        skip,
        take: limit,
        orderBy,
        include: {
          images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        },
      }),
      this.prisma.product.count(),
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
      items,
    };
  }

  async getBySlug(slug: string) {
    return this.prisma.product.findUnique({
      where: { slug },
      include: {
        images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
      },
    });
  }

  async createProduct(dto: CreateProductDto) {
    const currency = dto.currency ?? 'EUR';
    let images = dto.images ?? [];

    if (images.length > 0 && !images.some((image) => image.isPrimary === true)) {
      images = images.map((image, index) => ({ ...image, isPrimary: index === 0 }));
    }

    try {
      return await this.prisma.product.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          price: dto.price,
          currency,
          images: { create: images },
        },
        include: {
          images: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Slug already exists');
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
      return await this.prisma.$transaction(async (tx) => {
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

        const images = await tx.productImage.findMany({
          where: { productId: id },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        });

        if (images.length > 0 && !images.some((image) => image.isPrimary)) {
          await tx.productImage.update({
            where: { id: images[0].id },
            data: { isPrimary: true },
          });
        }

        return tx.product.findUnique({
          where: { id },
          include: { images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2002') {
          throw new ConflictException('Slug already exists');
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
      await this.prisma.$transaction([
        this.prisma.productImage.deleteMany({ where: { productId: id } }),
        this.prisma.product.delete({ where: { id } }),
      ]);
      return { ok: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Product not found');
      }
      throw e;
    }
  }

  async deleteImage(imageId: number) {
    try {
      const deleted = await this.prisma.productImage.delete({ where: { id: imageId } });
      const images = await this.prisma.productImage.findMany({
        where: { productId: deleted.productId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      });

      if (images.length > 0 && !images.some((image) => image.isPrimary)) {
        await this.prisma.productImage.update({
          where: { id: images[0].id },
          data: { isPrimary: true },
        });
      }

      return { ok: true };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException('Image not found');
      }
      throw e;
    }
  }
}
