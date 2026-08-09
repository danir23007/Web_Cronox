import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { QueryCategoriesDto } from './dto/query-categories.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(query: QueryCategoriesDto) {
    return this.list(query, { isActive: true });
  }

  async listAll(query: QueryCategoriesDto) {
    return this.list(query);
  }

  private async list(
    query: QueryCategoriesDto,
    where?: Prisma.CategoryWhereInput,
  ) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const skip = (page - 1) * limit;
    const orderByField = query.orderBy ?? 'name';
    const orderDirection = query.order ?? 'asc';

    const orderBy = {
      [orderByField]: orderDirection,
    } as Prisma.CategoryOrderByWithRelationInput;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.category.findMany({
        where,
        skip,
        take: limit,
        orderBy,
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      meta: {
        page,
        limit,
        total,
        pageCount: Math.ceil(total / limit),
        orderBy: orderByField,
        order: orderDirection,
      },
      items,
    };
  }

  async getActiveBySlugOrThrow(slug: string) {
    const normalizedSlug = this.normalizeSlug(slug);
    const category = await this.prisma.category.findFirst({
      where: { slug: normalizedSlug, isActive: true },
    });

    if (!category) {
      throw new NotFoundException('CATEGORY_NOT_FOUND');
    }

    return category;
  }

  async create(dto: CreateCategoryDto) {
    const slug = this.normalizeSlug(dto.slug);

    try {
      return await this.prisma.category.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,
          isActive: dto.isActive ?? true,
        },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const data: Prisma.CategoryUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.slug !== undefined) {
      data.slug = this.normalizeSlug(dto.slug);
    }
    if (dto.description !== undefined) {
      data.description = dto.description;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
    }

    try {
      return await this.prisma.category.update({
        where: { id },
        data,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.category.delete({ where: { id } });
      return { ok: true };
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private normalizeSlug(slug?: string) {
    if (!slug || typeof slug !== 'string') {
      throw new BadRequestException('SLUG_REQUIRED');
    }

    const normalized = slug
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    if (!normalized) {
      throw new BadRequestException('INVALID_SLUG');
    }

    return normalized;
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002' && Array.isArray(error.meta?.target)) {
        const target = error.meta?.target as string[];
        if (target.includes('slug')) {
          throw new ConflictException('CATEGORY_SLUG_ALREADY_EXISTS');
        }
      }
      if (error.code === 'P2025') {
        throw new NotFoundException('CATEGORY_NOT_FOUND');
      }
    }

    throw error;
  }
}
