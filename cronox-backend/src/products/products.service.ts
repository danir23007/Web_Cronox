import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Product, ProductImage } from '@prisma/client';

type ProductWithImages = Product & {
  images: Array<Pick<ProductImage, 'url' | 'alt' | 'sortOrder' | 'isPrimary'>>;
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  async findAll(): Promise<ProductWithImages[]> {
    return this.prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        images: {
          orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }],
          select: { url: true, alt: true, sortOrder: true, isPrimary: true },
        },
      },
    });
  }
}
