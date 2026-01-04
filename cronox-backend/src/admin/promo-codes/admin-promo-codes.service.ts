import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AdminCreatePromoCodeDto,
  AdminPromoCodeQueryDto,
  AdminUpdatePromoCodeDto,
} from './dto/admin-promo-code.dto';

@Injectable()
export class AdminPromoCodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminPromoCodeQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.PromoCodeWhereInput = {};

    if (query.search?.trim()) {
      const term = query.search.trim();
      where.code = { contains: term, mode: 'insensitive' };
    }

    if (query.isActive === 'true') {
      where.isActive = true;
    } else if (query.isActive === 'false') {
      where.isActive = false;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.promoCode.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.promoCode.count({ where }),
    ]);

    return {
      meta: {
        page,
        limit,
        total,
        pageCount: Math.ceil(total / limit) || 1,
      },
      items,
    };
  }

  async create(dto: AdminCreatePromoCodeDto, adminId?: number) {
    const code = this.normalizeCode(dto.code);
    try {
      const created = await this.prisma.promoCode.create({
        data: {
          code,
          type: dto.type,
          value: dto.value,
          minCartValue: dto.minCartValue ?? null,
          startsAt: dto.startsAt ?? null,
          expiresAt: dto.expiresAt ?? null,
          isActive: dto.isActive ?? true,
          usageLimit: dto.usageLimit ?? null,
          usageCount: 0,
        },
      });

      await this.recordAudit('promo.create', { promoCodeId: created.id, code }, adminId);
      return created;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('El código ya existe');
      }
      throw error;
    }
  }

  async update(id: number, dto: AdminUpdatePromoCodeDto, adminId?: number) {
    const data: Prisma.PromoCodeUpdateInput = {};

    if (dto.code !== undefined) {
      data.code = this.normalizeCode(dto.code);
    }

    if (dto.type !== undefined) data.type = dto.type;
    if (dto.value !== undefined) data.value = dto.value;
    if (dto.minCartValue !== undefined) data.minCartValue = dto.minCartValue;
    if (dto.startsAt !== undefined) data.startsAt = dto.startsAt;
    if (dto.expiresAt !== undefined) data.expiresAt = dto.expiresAt;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.usageLimit !== undefined) data.usageLimit = dto.usageLimit;

    try {
      const updated = await this.prisma.promoCode.update({
        where: { id },
        data,
      });

      await this.recordAudit('promo.update', { promoCodeId: id, payload: dto }, adminId);
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          throw new ConflictException('El código ya existe');
        }
        if (error.code === 'P2025') {
          throw new NotFoundException('PromoCode not found');
        }
      }
      throw error;
    }
  }

  async softDelete(id: number, adminId?: number) {
    const updated = await this.prisma.promoCode.update({
      where: { id },
      data: { isActive: false },
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('PromoCode not found');
      }
      throw error;
    });

    await this.recordAudit('promo.disable', { promoCodeId: id }, adminId);
    return updated;
  }

  private normalizeCode(code?: string | null) {
    return (code || '').replace(/\s+/g, '').toUpperCase();
  }

  private async recordAudit(action: string, metadata: Prisma.InputJsonValue, adminId?: number) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: adminId ?? null,
          action,
          metadata,
        },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[AUDIT_LOG] Error registrando auditoría', error);
    }
  }
}
