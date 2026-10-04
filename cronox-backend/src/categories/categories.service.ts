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
        orderBy: orderByField === 'id' ? orderBy : [orderBy, { id: 'asc' }],
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

  private nameKey(name: string) {
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  }

  private validateName(name: string) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new BadRequestException('INVALID_CATEGORY_NAME');
    return this.nameKey(name);
  }

  async create(dto: CreateCategoryDto) {
    if (!['GARMENT', 'DROP'].includes(dto.group)) throw new BadRequestException('INVALID_CATEGORY_GROUP');
    const key = this.validateName(dto.name), slug = this.normalizeSlug(dto.slug ?? dto.name);
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(435276902)`;
        const existing = await tx.category.findMany({ select: { name: true } });
        if (existing.some(c => this.nameKey(c.name) === key)) throw new ConflictException('CATEGORY_NAME_ALREADY_EXISTS');
        return tx.category.create({ data: { name: dto.name.trim().replace(/\s+/g, ' '), slug, group: dto.group, description: dto.description, isActive: dto.isActive ?? true } });
      });
    } catch (error) { this.handlePrismaError(error); }
  }

  async update(id: number, dto: UpdateCategoryDto) {
    if (dto.group !== undefined && !['GARMENT', 'DROP'].includes(dto.group)) throw new BadRequestException('INVALID_CATEGORY_GROUP');
    try {
      return await this.prisma.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(435276902)`;
        const current = await tx.category.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('CATEGORY_NOT_FOUND');
        if (current.group === 'NEW' && (dto.group !== undefined || (dto.slug !== undefined && dto.slug !== current.slug))) throw new BadRequestException('NEW_CATEGORY_IS_RESERVED');
        const data: Prisma.CategoryUpdateInput = {};
        if (dto.name !== undefined) {
          const key = this.validateName(dto.name);
          const others = await tx.category.findMany({ where: { id: { not: id } }, select: { name: true } });
          if (others.some(c => this.nameKey(c.name) === key)) throw new ConflictException('CATEGORY_NAME_ALREADY_EXISTS');
          data.name = dto.name.trim().replace(/\s+/g, ' ');
        }
        if (dto.slug !== undefined) data.slug = this.normalizeSlug(dto.slug);
        if (dto.group !== undefined) data.group = dto.group;
        if (dto.description !== undefined) data.description = dto.description;
        if (dto.isActive !== undefined) data.isActive = dto.isActive;
        return tx.category.update({ where: { id }, data });
      });
    } catch (error) { this.handlePrismaError(error); }
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
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
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
