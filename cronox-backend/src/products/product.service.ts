import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}

  async getAllProducts() {
    return this.prisma.product.findMany({
      include: {
        images: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  async getBySlug(slug: string) {
    return this.prisma.product.findUnique({
      where: { slug },
      include: {
        images: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
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
}
